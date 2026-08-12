# astrbot_plugin_wuhebingo
import json, os
from astrbot.api.event import filter, AstrMessageEvent
from astrbot.api.star import Context, Star
from astrbot.api.message_components import Node, Plain

CL = "ABCDEFGHIJKLMNOPQRSTUVWXY"
STATUS_EMOJI = {"done": "\u2705", "progress": "\u25d0", "none": "\u2b1c"}

class WuheBingoPlugin(Star):
    def __init__(self, context: Context, config):
        super().__init__(context)
        self.season_dir = config.get("season_dir", r"E:\wuhebingo\rS1")
        self.config_dir = config.get("config_dir", r"E:\wuhebingo\zlwuhe")

    def _load_json(self, path):
        if not os.path.exists(path): return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _load_state(self):
        f = os.path.join(self.season_dir, "state.json")
        return self._load_json(f) or None

    def _cell_status(self, cell, goal_default=1):
        if cell["completed"]:
            return STATUS_EMOJI["done"]
        if cell.get("progress", 0) > 0:
            return STATUS_EMOJI["progress"]
        return STATUS_EMOJI["none"]

    def _make_node(self, uin, name, text):
        return Node(uin=uin, name=name, content=[Plain(text)])

    @filter.command("帮助")
    async def cmd_help(self, event: AstrMessageEvent):
        yield event.chain_result([self._make_node(event.get_sender_id(), "帮助",
            "介绍 - 游戏介绍\n"
            "玩家 <名字> - 5x5矩阵进度\n"
            "玩家 <名字> <格子> - 任务详情\n"
            "易位 [玩家名] - 易位记录\n"
            "任务 - 全部任务描述\n"
            "链接 - 相关链接\n"
            "订阅 - 新回合开始自动@提醒\n"
            "取消订阅 - 关闭回合@提醒\n"
            "问卷帮助 - 查看问卷池帮助")])

    @filter.command("介绍")
    async def cmd_intro(self, event: AstrMessageEvent):
        path = os.path.join(self.config_dir, "intro.txt")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        else:
            text = "乌合bingo 赛季制竞猜策略桌游。"
        yield event.chain_result([self._make_node(event.get_sender_id(), "介绍", text)])

    @filter.command("玩家")
    async def cmd_player(self, event: AstrMessageEvent):
        s = self._load_state()
        if not s:
            yield event.plain_result("无数据")
            return
        parts = event.message_str.split()
        if len(parts) < 2:
            yield event.plain_result("用法: 玩家 <名字> [格子]")
            return
        name = parts[1]
        # 彩蛋: zl 显示全版完成
        if name.lower() == 'zl':
            if len(parts) >= 3:
                cell = parts[2].upper()
                if cell in CL:
                    t = s["board"][CL.index(cell)]
                    yield event.chain_result([self._make_node(event.get_sender_id(), "zl", f"{cell} \u2705 {t['desc']}")])
                    return
            lines = ["zl 25/25"]
            for row in range(5):
                row_parts = []
                for col in range(5):
                    row_parts.append(f"{CL[row*5+col]}\u2705")
                lines.append(" ".join(row_parts))
            yield event.chain_result([self._make_node(event.get_sender_id(), "zl", "\n".join(lines))])
            return
        matches = [n for n in s["playerBoards"] if name.lower() in n.lower()]
        if not matches:
            yield event.plain_result(f"未找到: {name}")
            return
        pn = matches[0]
        b = s["playerBoards"][pn]
        lm = s.get("playerLabelMap", {}).get(pn)
        bot_uin = event.get_sender_id()

        if len(parts) >= 3:
            cell = parts[2].upper()
            if cell not in CL:
                yield event.plain_result(f"无效: {cell}")
                return
            idx = lm.index(cell) if lm and cell in lm else CL.index(cell)
            # 使用玩家的taskMap获取正确的任务ID(易位后可能已变)
            tm = s.get("playerTaskMap", {}).get(pn)
            taskId = tm[idx] if tm else s["board"][idx]["id"]
            t = next((x for x in s["board"] if x["id"] == taskId), s["board"][idx])
            c = b[idx]
            goal = c.get("goal") or t.get("param") or 1
            st = self._cell_status(c, goal)
            extra = ""
            if c.get("digits"):
                ds = [str(d) if c["digits"].get(str(d)) else "-" for d in range(10)]
                extra = f" [{''.join(ds)}]"
            progress_info = ""
            if not c["completed"] and c.get("progress", 0) > 0:
                progress_info = f" ({c['progress']}/{goal})"
            yield event.chain_result([self._make_node(bot_uin, pn, f"{cell} {st} {t['desc']}{extra}{progress_info}")])
            return

        total = sum(1 for c in b if c["completed"])
        # 检查该玩家的易位指定格
        ca = s.get("castling", {})
        cplayer = ca.get("players", {}).get(pn, {})
        pending_pos = cplayer.get("pendingCell")
        lines = [f"{pn} {total}/25"]
        for row in range(5):
            row_parts = []
            for col in range(5):
                idx = row * 5 + col
                label = lm[idx] if lm else CL[idx]
                goal = b[idx].get("goal") or s["board"][idx].get("param") or 1
                status = f"{label}{self._cell_status(b[idx], goal)}"
                if pending_pos is not None and idx == pending_pos:
                    status += "*"
                row_parts.append(status)
            lines.append(" ".join(row_parts))
        yield event.chain_result([self._make_node(bot_uin, pn, "\n".join(lines))])

    @filter.command("易位")
    async def cmd_castle(self, event: AstrMessageEvent):
        s = self._load_state()
        if not s:
            yield event.plain_result("无数据")
            return
        parts = event.message_str.split()
        filter_name = parts[1] if len(parts) > 1 else ""
        log = s.get("castling", {}).get("log", [])
        if not log:
            yield event.chain_result([self._make_node(event.get_sender_id(), "易位", "无记录")])
            return
        lines = []
        for l in log:
            if filter_name and filter_name.lower() not in l["player"].lower():
                continue
            if l["act"] == "spec":
                lines.append(f"[R{l['round']}] {l['player']} 指定 {l['cell']}")
            elif l["act"] == "swap":
                lines.append(f"[R{l['round']}] {l['player']} 交换 {l['from']} ↔ {l['to']}")
            elif l["act"] == "complete":
                lines.append(f"[R{l['round']}] {l['player']} {l['cell']} 已完成(+2)")
        title = f"易位记录 ({filter_name})" if filter_name else "易位记录"
        yield event.chain_result([self._make_node(event.get_sender_id(), title, "\n".join(lines) or "无记录")])

    @filter.command("任务")
    async def cmd_tasks(self, event: AstrMessageEvent):
        s = self._load_state()
        if not s:
            yield event.plain_result("无数据")
            return
        lines = []
        for i in range(25):
            t = s["board"][i]
            lines.append(f"{CL[i]} {t['id']} {t['desc']}")
        yield event.chain_result([self._make_node(event.get_sender_id(), "任务列表", "\n".join(lines))])

    @filter.command("链接")
    async def cmd_links(self, event: AstrMessageEvent):
        cfg = self._load_json(os.path.join(self.config_dir, "links.json"))
        if not cfg.get("items"):
            yield event.plain_result("未配置链接")
            return
        lines = [cfg.get("title", "相关链接")]
        for item in cfg["items"]:
            lines.append(f"{item['name']}: {item['url']}")
        yield event.chain_result([self._make_node(event.get_sender_id(), "链接", "\n".join(lines))])
    @filter.command("订阅")
    async def cmd_subscribe(self, event: AstrMessageEvent):
        cfg_path = os.path.join(self.config_dir, "subscriptions.json")
        cfg = self._load_json(cfg_path)
        subs = cfg.get("subscribers", [])
        qq = event.get_sender_id()
        if any(s.get("qq") == qq for s in subs):
            yield event.plain_result("你已在订阅名单里，新回合开始时会自动@你。")
            return
        try:
            session = f"{event.get_platform_id()}:{event.get_message_type()}:{event.get_session_id()}"
        except Exception:
            session = ""
        import time
        subs.append({"qq": qq, "session": session, "time": time.strftime("%Y-%m-%d %H:%M:%S")})
        cfg["subscribers"] = subs
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        if session:
            yield event.plain_result("订阅成功！新回合开始时会自动@你（建议在游戏群里订阅，才能被@到）。")
        else:
            yield event.plain_result("订阅成功！但未识别到群会话，可能无法自动@，建议在游戏群里重新订阅。")

    @filter.command("取消订阅")
    async def cmd_unsubscribe(self, event: AstrMessageEvent):
        cfg_path = os.path.join(self.config_dir, "subscriptions.json")
        cfg = self._load_json(cfg_path)
        subs = cfg.get("subscribers", [])
        qq = event.get_sender_id()
        before = len(subs)
        cfg["subscribers"] = [s for s in subs if s.get("qq") != qq]
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        if len(cfg["subscribers"]) < before:
            yield event.plain_result("已取消订阅，之后新回合不再@你。")
        else:
            yield event.plain_result("你本来就不在订阅名单里。")
