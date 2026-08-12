# astrbot_plugin_quiz
import json, os, time, random, asyncio, subprocess, datetime
from astrbot.api.event import filter, AstrMessageEvent, MessageChain
from astrbot.api.star import Context, Star
from astrbot.api.message_components import Plain, Node

def _log(msg):
    with open(os.path.join(os.path.dirname(__file__), "debug.log"), "a", encoding="utf-8") as f:
        f.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {msg}\n")

game = {"active": False, "question": None, "answers": {}, "timer": None, "group_id": None}

class QuizPlugin(Star):
    def __init__(self, context: Context, config):
        super().__init__(context)
        self.bank_file = config.get("bank_file", r"E:\wuhebingo\题库.json")
        self.core_js = config.get("core_js", r"E:\wuhebingo\core.js")

    def _load_bank(self):
        js = "var t=require('fs').readFileSync('" + self.bank_file.replace("\\", "/") + "','utf8');var c=require('" + self.core_js.replace("\\", "/") + "');var b=c.parseJSON(t);console.log(JSON.stringify(b.questions||[]));"
        r = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return []
        return json.loads(r.stdout)

    def _eval_formula(self, formula, ctx):
        try:
            inp = json.dumps({"formula": formula, "ctx": ctx})
            js = "var c=require('" + self.core_js.replace("\\", "/") + "');var d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(''+c.evaluateFormula(d.formula,d.ctx));"
            r = subprocess.run(["node", "-e", js], input=inp, capture_output=True, text=True, timeout=5)
            result = r.stdout.strip() or "0"
            if r.stderr:
                _log(f"[eval err] {r.stderr}")
            return float(result)
        except Exception as e:
            _log(f"[eval fail] {e}")
            return 0

    async def _end_game(self):
        global game
        game["active"] = False
        q = game["question"]
        answers = game["answers"]
        group_id = game["group_id"]
        game["answers"] = {}
        game["question"] = None
        game["group_id"] = None
        if not q:
            return
        options = q.get("options", [])
        formula = q.get("formula", "")
        title = q.get("text", q.get("title", "题目"))
        qtype = q.get("type", "single")

        if not answers:
            if group_id:
                await self.context.send_message(group_id, MessageChain().message(f"[随机乌合] {title} 无人参与"))
            return

        counts = {}
        for o in options:
            counts[o.get("label", "")] = 0
        for ans in answers.values():
            val = ans.get("value", "")
            if val in counts:
                counts[val] += 1
            elif qtype == "text":
                counts[val] = (counts.get(val) or 0) + 1

        scores = {}
        if formula:
            opt_labels = [o["label"] for o in options] if options else []
            for uid, ans in answers.items():
                val = ans.get("value", "")
                c2 = {"options": counts.copy(), "total": len(answers), "score": 0}
                for o in options:
                    c2[o["label"]] = counts.get(o["label"], 0)
                if qtype == "single":
                    c2["choice"] = next((j for j, o in enumerate(options) if o["label"] == val), -1)
                    c2["value"] = val
                elif qtype == "multi":
                    raw = val.upper().replace(",", "").replace("，", "").replace(" ", "")
                    parts2 = list(raw) if all(c in opt_labels for c in raw) else [p.upper() for p in val.replace(",", " ").replace("，", " ").split() if p]
                    for o in options:
                        c2["chose_" + o["label"]] = 1 if o["label"] in parts2 else 0
                    my_set = ",".join(sorted(parts2))
                    cnt = 0
                    for a in answers.values():
                        av = a.get("value", "").upper().replace(",", "").replace("，", "").replace(" ", "")
                        ap = list(av) if all(c in opt_labels for c in av) else [p.upper() for p in a.get("value", "").replace(",", " ").replace("，", " ").split() if p]
                        if ",".join(sorted(ap)) == my_set:
                            cnt += 1
                    c2["same_set"] = 1 if cnt == 1 else 0
                    c2["same_count"] = cnt
                elif qtype == "text":
                    try:
                        c2["value"] = float(val)
                        c2["sum"] = sum(float(a.get("value", 0) or 0) for a in answers.values())
                    except:
                        c2["value"] = val
                        c2["sum"] = 0
                scores[uid] = self._eval_formula(formula, c2)
        _log(f"[SCORES] formula={bool(formula)} opts={bool(options)} count={len(scores)}")
        if scores:
            for uid, sc in list(scores.items())[:3]:
                _log(f"  {uid}: {sc}")

        ranked = sorted(scores.items(), key=lambda x: -x[1]) if scores else []
        pub = f"[随机乌合] {title} 结束 (共{len(answers)}人)\n"
        for uid, ans in answers.items():
            name = ans.get("name", uid)
            val = ans.get("value", "")
            sc = scores.get(uid, 0)
            rk = next((i + 1 for i, (u, _) in enumerate(ranked) if u == uid), "?")
            pub += f"{name}: {val} ({sc:.2f} 排名{rk})\n"
        if group_id:
            await self.context.send_message(group_id, MessageChain().message(pub))

    @filter.command("随机帮助")
    async def cmd_quiz_help(self, event: AstrMessageEvent):
        yield event.plain_result("随机乌合 [人数] [类型] [ID:xxx] - 开始\n答 <答案> - 提交\n查看乌合 - 查看题目\n结束乌合 - 提前结束")

    @filter.command("随机乌合")
    async def cmd_start(self, event: AstrMessageEvent):
        global game
        if game["active"]:
            yield event.plain_result("有进行中的游戏")
            return
        parts = event.message_str.split()
        max_players = 12
        qfilter = ""
        qid = ""
        if len(parts) > 1:
            try:
                max_players = int(parts[1])
                if len(parts) > 2:
                    arg2 = parts[2]
                    if arg2.lower().startswith("id:"):
                        qid = arg2[3:].upper()
                    else:
                        qfilter = arg2.lower()
            except:
                arg1 = parts[1]
                if arg1.lower().startswith("id:"):
                    qid = arg1[3:].upper()
                    max_players = 10
                else:
                    max_players = 10
                    qfilter = arg1.lower()
        max_players = max(1, min(50, max_players))

        bank = self._load_bank()
        pool = bank if isinstance(bank, list) else bank.get("questions", [])
        if qid:
            pool = [q for q in pool if q.get("id", "").upper() == qid.upper()]
        else:
            pool = [q for q in pool if q.get("id") != "T10" and q.get("enabled", True)]
            if qfilter:
                pool = [q for q in pool if (q.get("type", "") == qfilter)]
        if not pool:
            yield event.plain_result("无符合条件的题目")
            return

        q = random.choice(pool)
        # 题目默认人数覆盖用户指定的默认值
        if not qfilter and not qid and len(parts) <= 1:
            max_players = int(q.get("_players", 0)) or 12
        game["question"] = q
        game["answers"] = {}
        game["active"] = True
        game["group_id"] = event.unified_msg_origin
        game["max_players"] = max_players

        qtype = q.get("type", "single")
        qtype_cn = {"single": "单选", "multi": "多选", "text": "填空"}.get(qtype, qtype)
        options = q.get("options", [])
        lines = [f"[随机乌合] {q.get('text', q.get('title', '题目'))}"]
        if q.get("desc"):
            lines.append(f"说明: {q['desc']}")
        lines.append(f"类型: {qtype_cn} | 人数: {len(game['answers'])}/{max_players}")
        if options:
            lines.append("选项:")
            for o in options:
                lines.append(f"  {o.get('label','?')}. {o.get('text','')}")
        lines.append("\n@bot 答 <答案> 提交")
        yield event.plain_result("\n".join(lines))

    @filter.command("查看乌合")
    async def cmd_view(self, event: AstrMessageEvent):
        if not game["active"]:
            yield event.plain_result("无进行中的游戏")
            return
        q = game["question"]
        qtype = q.get("type", "single")
        qtype_cn = {"single": "单选", "multi": "多选", "text": "填空"}.get(qtype, qtype)
        options = q.get("options", [])
        lines = [f"[进行中] {q.get('text', q.get('title', '题目'))}"]
        if q.get("desc"):
            lines.append(f"说明: {q['desc']}")
        lines.append(f"类型: {qtype_cn} | 已参与: {len(game['answers'])}/{game.get('max_players', '?')}人")
        if options:
            for o in options:
                lines.append(f"  {o.get('label','?')}. {o.get('text','')}")
        lines.append("\n@bot 答 <答案> 提交（可私信）")
        yield event.plain_result("\n".join(lines))

    @filter.command("结束乌合")
    async def cmd_end(self, event: AstrMessageEvent):
        if not game["active"]:
            yield event.plain_result("无进行中的游戏")
            return
        if game.get("timer"):
            game["timer"].cancel()
        await self._end_game()

    @filter.command("答")
    async def cmd_answer(self, event: AstrMessageEvent):
        if not game["active"]:
            return
        parts = event.message_str.split(maxsplit=1)
        text = parts[1].strip() if len(parts) > 1 else ""
        if not text:
            yield event.plain_result("格式: 答 <你的答案>")
            return

        q = game["question"]
        qtype = q.get("type", "single")
        options = q.get("options", [])
        labels = [o.get("label", "") for o in options]
        if qtype == "multi":
            min_fill = q.get("minSel", 0) or 0
            max_fill = q.get("maxSel", len(labels)) or len(labels)
        else:
            min_fill = q.get("minFill", 0) or 0
            max_fill = q.get("maxFill", 1) or 1
        uid = event.get_sender_id()
        name = event.get_sender_name() or uid

        if qtype == "single":
            if text.upper() not in labels:
                yield event.plain_result(f"无效选项, 可选: {','.join(labels)}")
                return
            game["answers"][uid] = {"name": name, "value": text.upper()}
            yield event.plain_result(f"已记录: {text.upper()}")
            if len(game["answers"]) >= game.get("max_players", 10):
                await self._end_game()
            return

        if qtype == "multi":
            raw = "".join(sorted(set(text.upper().replace(",", "").replace("，", "").replace(" ", "").strip())))
            _log(f"[MULTI] raw={raw} len={len(raw)} min={min_fill} max={max_fill} labels={labels}")
            if not raw or not all(c in labels for c in raw):
                yield event.plain_result(f"无效, 连写如ABC, 可选: {','.join(labels)}")
                return
            if len(raw) < min_fill:
                yield event.plain_result(f"至少选{min_fill}项")
                return
            if len(raw) > max_fill:
                yield event.plain_result(f"最多选{max_fill}项")
                return
        game["answers"][uid] = {"name": name, "value": raw}
        yield event.plain_result(f"已记录: {raw}")
        # 人满自动开卷
        if len(game["answers"]) >= game.get("max_players", 10):
            await self._end_game()
            return

        # text
        try:
            v = int(text)
        except ValueError:
            try:
                float(text)
                yield event.plain_result("请输入整数")
            except ValueError:
                yield event.plain_result("请输入数字")
            return
        if v < min_fill:
            yield event.plain_result(f"不低于{min_fill}")
            return
        if max_fill and v > max_fill:
            yield event.plain_result(f"不超过{max_fill}")
            return
        game["answers"][uid] = {"name": name, "value": str(v)}
        yield event.plain_result(f"已记录: {v}")
        if len(game["answers"]) >= game.get("max_players", 10):
            await self._end_game()
