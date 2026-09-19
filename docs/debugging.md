# 调试信息查看与 Bug 反馈教程

遇到翻译失败、译文不显示、桥连不上等问题时,按本教程收集调试信息再反馈,
能极大加快定位速度。**所有日志都在本地,上传前可自行检查,不含 API Key。**

---

## 1. 问题发生的第一个判断:桥在不在运行?

打开设置面板(游戏内聊天输入 `/tr` 回车),看「本地桥状态」一行:

| 显示 | 含义 | 下一步 |
| --- | --- | --- |
| **运行中 (端口 8791)**(绿色) | 桥正常 | 翻译问题 → 看第 3 节日志 |
| **未运行**(红色) | 桥没起来或挂了 | 先双击 `restart_bridge.bat` 重启桥 |

聊天界面左下角(或状态栏)还有桥状态圆点:**绿 = 在线,红 = 离线**;
翻译失败时会短暂闪**黄色**提醒。

> 用 Deadlock Mod Manager 安装、只放了 VPK 没装本地桥的用户,面板会提示先安装桥
> (完整包见 GitHub Releases / GameBanana 附件)。

## 2. 桥日志:logs/bridge.log(反馈必附)

桥的所有动作都记录在项目目录下的 **`logs\bridge.log`**
(每行格式:`[日期 时间] [级别] 内容`)。

**查看方法**:用记事本打开 `BabelTower\logs\bridge.log`
(或直接在项目目录资源管理器地址栏输入 `logs` 回车)。

常见日志关键字对照:

| 日志内容 | 含义 |
| --- | --- |
| `bridge listening on http://127.0.0.1:8791` | 桥启动成功 |
| `provider: bing, target: zh-Hans` | 当前服务商与目标语言 |
| `translate ok: ...` | 翻译成功(后面是原文) |
| `translate failed: ...` | **翻译失败,这一行就是错误原因** |
| `cache hit: ...` | 命中缓存(未走网络) |
| `fallback -> xxx` | 主服务商失败,已自动切换到备用服务商 |
| `429 限流,等待 ...ms 后重试` | 翻译接口限流,自动退避中 |
| `发现新版本: x.y.z -> a.b.c` | 有新版本可更新 |

**反馈时请提供**:出问题时间点前后的日志片段(比如最近 30~50 行),
特别是 `translate failed` / `fallback` / `429` 相关的行。

> 提示:如果 `logs\bridge.log` 不存在或很旧,说明你的桥配置里日志没开——
> v1.0.5 起默认开启;老版本可在 `config\config.json` 里把 `"logFile"` 改为
> `"logs/bridge.log"` 后重启桥。

## 3. 手动验证翻译链路(可选,但很有用)

桥运行时,在浏览器或 PowerShell 里执行:

```powershell
# 健康检查(应返回 JSON,含 version / provider)
curl.exe http://127.0.0.1:8791/api/v1/health

# 实测一次翻译(应返回 {"ok":true,"translation":"你好",...})
curl.exe -X POST http://127.0.0.1:8791/api/v1/translate -H "Content-Type: application/json" -d "{\"text\":\"hello\",\"targetLanguage\":\"zh-Hans\"}"
```

- 健康检查失败 → 桥没运行,回到第 1 节
- 翻译请求报错 → 把返回的 JSON 和 `bridge.log` 里的 `translate failed` 行一起反馈

## 4. 游戏内调试信息(可选)

游戏控制台(VConsole,启动参数加 `-tools` 后按 `~` 或在设置里开启)中,
本 mod 的日志以 `[LCT]` 前缀输出,例如:

- `[LCT] bridge panel found; SetURL=yes/no` —— 游戏内隐藏面板是否挂上
- `bridge online` —— 游戏侧确认桥可达

反馈"游戏内完全不显示译文"这类问题时,请一并说明控制台里有无 `[LCT]` 报错。

## 5. 提交 Bug:去哪里、怎么写

**反馈入口(二选一)**:

- GitHub Issues(推荐):https://github.com/c1375rick/BabelTower/issues
  → New issue → 选择「Bug Report」模板
- GameBanana 模组页评论区:在评论区描述问题即可(作者会跟进)

**Bug 报告请包含**(模板里已列出,这里解释原因):

1. **Mod 版本**:设置面板底部/Release 附件名,如 `1.0.4`
   (旧版本的问题可能在新版已修复,先升级再试)
2. **问题现象**:什么操作、期望什么、实际发生什么
3. **bridge.log 片段**:出问题时间点前后 30~50 行(见第 2 节)
4. **安装方式**:Mod Manager 导入 / 手动放 VPK;桥是自启还是手动
5. **网络环境**:是否中国大陆直连 / 是否使用代理(影响公共翻译接口连通性)

**隐私说明**:

- 日志不含 API Key(代码层面保证:密钥绝不写日志)
- 聊天日志(`logs/chat/*.jsonl`)按比赛 ID 记录原文与译文,如涉及隐私请只贴
  `bridge.log` 中 `translate failed` 相关行,不要整包上传聊天记录

## 6. 提交前自查清单

- [ ] 已升级到最新 Release(见 https://github.com/c1375rick/BabelTower/releases)
- [ ] 桥状态绿色/「运行中」
- [ ] 已收集 `logs\bridge.log` 相关片段
- [ ] 已注明 Mod 版本与安装方式
- [ ] 日志中无 API Key / 个人敏感信息
