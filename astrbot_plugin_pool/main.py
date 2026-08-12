# astrbot_plugin_pool
import json, os, time
from astrbot.api.event import filter, AstrMessageEvent
from astrbot.api.star import Context, Star

class PoolPlugin(Star):
    def __init__(self, context: Context, config):
        super().__init__(context)
        self.pool_file = config.get("pool_file", r"E:\wuhebingo\zlwuhe\pool.json")
        self.config_file = config.get("config_file", r"E:\wuhebingo\zlwuhe\pool_config.json")
        self.ttl = int(config.get("ttl_hours", 72)) * 3600

    def _load_config(self):
        if not os.path.exists(self.config_file):
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump({"admins": []}, f, ensure_ascii=False, indent=2)
            return {"admins": []}
        with open(self.config_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def _load(self):
        if not os.path.exists(self.pool_file): return {"items": []}
        with open(self.pool_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        now = time.time()
        data["items"] = [i for i in data["items"] if now - i.get("time", 0) < self.ttl]
        return data

    def _save(self, data):
        with open(self.pool_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _remaining(self, t):
        left = self.ttl - (time.time() - t)
        if left <= 0: return "已过期"
        h = int(left // 3600)
        m = int((left % 3600) // 60)
        return f"{h}h{m}m"

    async def _is_admin(self, event: AstrMessageEvent):
        cfg = self._load_config()
        sender_id = str(event.get_sender_id())
        if sender_id in cfg.get("admins", []):
            return True
        try:
            role = getattr(event, "role", None)
            if role and role in ("owner", "admin"): return True
            sender = getattr(event, "sender", None)
            if sender and sender.get("role") in ("owner", "admin"): return True
        except Exception:
            pass
        return False

    @filter.command("问卷帮助")
    async def cmd_help(self, event: AstrMessageEvent):
        yield event.plain_result(
            "问卷 - 查看所有链接\n"
            "加问卷 <链接> [描述] - 添加\n"
            "删问卷 <序号> - 删除(添加者/管理)\n"
            "修改描述 <序号> <描述> - 修改描述\n"
            "刷新 <序号> - 重置计时\n"
            "刷新 all - 重置全部计时(仅管理员)"
        )

    @filter.command("问卷")
    async def cmd_list(self, event: AstrMessageEvent):
        data = self._load()
        if not data["items"]:
            yield event.plain_result("问卷池为空")
            return
        lines = ["[问卷池]"]
        for i, item in enumerate(data["items"], 1):
            desc = (item.get("desc") or "").strip()
            rem = self._remaining(item["time"])
            if desc:
                lines.append(f"{i}. {rem}")
                lines.append(desc)
                lines.append(item["url"])
            else:
                lines.append(f"{i}. {rem}")
                lines.append(item["url"])
        yield event.plain_result("\n".join(lines))

    @filter.command("加问卷")
    async def cmd_add(self, event: AstrMessageEvent):
        parts = event.message_str.split(maxsplit=1)
        arg = parts[1].strip() if len(parts) > 1 else ""
        if not arg:
            yield event.plain_result("用法: 加问卷 <链接> [描述]")
            return
        idx = arg.find(" ")
        if idx < 0:
            url, desc = arg, ""
        else:
            url, desc = arg[:idx].strip(), arg[idx+1:].strip()
        if not url.startswith("http"):
            yield event.plain_result("链接需以 http 开头")
            return
        data = self._load()
        data["items"].append({
            "url": url, "desc": desc,
            "time": time.time(),
            "adder": event.get_sender_id()
        })
        self._save(data)
        yield event.plain_result(f"已添加 ({len(data['items'])}): {desc or url[:30]}")

    @filter.command("删问卷")
    async def cmd_del(self, event: AstrMessageEvent):
        parts = event.message_str.split()
        if len(parts) < 2:
            yield event.plain_result("用法: 删问卷 <序号>")
            return
        try:
            idx = int(parts[1]) - 1
        except ValueError:
            yield event.plain_result("序号需为数字")
            return
        data = self._load()
        if idx < 0 or idx >= len(data["items"]):
            yield event.plain_result("序号超出范围")
            return
        item = data["items"][idx]
        sender = event.get_sender_id()
        if sender != item.get("adder") and not await self._is_admin(event):
            yield event.plain_result("只能删除自己添加的问卷")
            return
        data["items"].pop(idx)
        self._save(data)
        yield event.plain_result(f"已删除: {item.get('desc') or item['url'][:30]}")

    @filter.command("修改描述")
    async def cmd_edit(self, event: AstrMessageEvent):
        parts = event.message_str.split(maxsplit=1)
        arg = parts[1].strip() if len(parts) > 1 else ""
        idx_space = arg.find(" ")
        if idx_space < 0:
            yield event.plain_result("用法: 修改描述 <序号> <新描述>")
            return
        try:
            idx = int(arg[:idx_space]) - 1
        except ValueError:
            yield event.plain_result("序号需为数字")
            return
        new_desc = arg[idx_space+1:].strip()
        data = self._load()
        if idx < 0 or idx >= len(data["items"]):
            yield event.plain_result("序号超出范围")
            return
        item = data["items"][idx]
        sender = event.get_sender_id()
        if sender != item.get("adder") and not await self._is_admin(event):
            yield event.plain_result("只能修改自己添加的问卷")
            return
        item["desc"] = new_desc
        self._save(data)
        yield event.plain_result(f"描述已更新: {new_desc[:30]}")

    @filter.command("刷新")
    async def cmd_refresh(self, event: AstrMessageEvent):
        parts = event.message_str.split()
        if len(parts) < 2:
            yield event.plain_result("用法: 刷新 <序号> 或 刷新 all(管理员)")
            return
        arg = parts[1].strip().lower()
        data = self._load()
        if arg in ("all", "全部"):
            if not await self._is_admin(event):
                yield event.plain_result("仅管理员可使用 刷新 all")
                return
            if not data["items"]:
                yield event.plain_result("问卷池为空")
                return
            now = time.time()
            for item in data["items"]:
                item["time"] = now
            self._save(data)
            yield event.plain_result(f"已刷新全部 {len(data['items'])} 条问卷计时")
            return
        try:
            idx = int(parts[1]) - 1
        except ValueError:
            yield event.plain_result("序号需为数字, 或使用 all")
            return
        if idx < 0 or idx >= len(data["items"]):
            yield event.plain_result("序号超出范围")
            return
        item = data["items"][idx]
        item["time"] = time.time()
        self._save(data)
        yield event.plain_result(f"已刷新: {item.get('desc') or item['url'][:30]}")
