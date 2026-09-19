# GameBanana 更新日志填写模板(Babel Tower)

> 每次发新版时对照本文件填写,复制对应内容到 GameBanana 表单即可。
> 配套文档:首次提交看 `SUBMISSION_GUIDE.md`;自动提交看 `scripts/gb_add_update.js`。

## 入口与前置

- Mod 页: https://gamebanana.com/mods/700107
- 更新入口: Mod 页右上角 **Add Update**(或 https://gamebanana.com/mods/updates/700107 )
- 填之前确认(缺一不可):
  - [ ] GitHub Release 已发布(脚本:`powershell -ExecutionPolicy Bypass -File scripts\release.ps1`)
  - [ ] `dist\BabelTower-<版本>-win64.zip` 已生成
  - [ ] 新版 zip 已上传到 Mod 页 Files 区(旧文件可归档),Add Update 里才能勾选它
- 填表信息从哪来:
  - 更新内容:`git log vX.Y.Z..HEAD --oneline`(上一个 tag 到现在)
  - 版本号:`VERSION` 文件(注意发布脚本会自增,GameBanana 填"刚发布的那个"版本)

---

## 一、标题(_sName)

```
{{版本}} {{一句话主题}}
```

- 规则:一行、≤60 字符、含版本号和关键词(修复/新增/优化),不写句号
- 例:`1.0.4 修复翻译 401:切换 Edge 免 token 端点`

## 二、版本号(_sVersion)

```
{{x.y.z}}
```

- 必须与 zip 文件名、GitHub tag 三处一致(如 1.0.4)

## 三、Changelog 条目(逐条添加,每条一行)

```
{{Type}} | {{一句话描述}}
```

- Type 用表单下拉里的英文选项,常见:`Bugfix` / `Improvement` / `Addition` / `Tweak` / `Removal`(以页面下拉实际可选项为准)
- 描述写「结果」,不写「过程」:Bugfix 用「修复 X 导致 Y」;Improvement 用「新增/优化 X:效果」
- 条数 2~6 条为宜,最重要的放最前;纯版本号自增、文档类提交不要写进来

## 四、Blurb(更新简介,粘贴进富文本框)

```
请下载新的 BabelTower-{{x.y.z}}-win64.zip。{{一段话概括:修了什么/加了什么,给玩家的影响}}。详见 GitHub Release: https://github.com/c1375rick/BabelTower/releases/tag/v{{x.y.z}}
```

- 按改动范围追加对应提示(二选一,很重要,减少重复提问):
  - 仅本地桥/脚本改动:`本次仅改本地桥,VPK 无变化,老用户重新解压覆盖后运行 restart_bridge.bat 即可`
  - 含游戏内界面改动:`含游戏内界面改动,请用 Mod Manager 重新导入 pak01_dir.vpk`

## 五、勾选文件

- 勾选本次的 `BabelTower-{{x.y.z}}-win64.zip`(只勾这一个,别勾旧文件)

## 六、提交前检查

- [ ] 标题/版本号/zip 三处版本一致
- [ ] Changelog 每条 Type 与内容匹配,无错别字
- [ ] Blurb 里 GitHub Release 链接的 tag 正确
- [ ] 已勾选本次 zip
- [ ] 提交后打开 Mod 页确认更新条目显示正常、文件可下载

---

## 附:填写示例(真实案例 v1.0.4)

**标题**

```
1.0.4 修复翻译 401:切换 Edge 免 token 端点
```

**版本号**

```
1.0.4
```

**Changelog**

```
Bugfix | 修复 Bing 免 Key 接口间歇性 401:微软区域跳转导致 cn 子域签发的 token 被自己的翻译接口拒绝
Improvement | 改用 Edge 内置翻译免鉴权端点(translatetext),无需 token/Key,翻译链路更稳定
Improvement | 保留 429 限流指数退避重试;移除不再需要的 en→en-GB 兼容处理
```

**Blurb**

```
请下载新的 BabelTower-1.0.4-win64.zip。修复 Bing 公共翻译接口间歇性 401(微软区域跳转导致 token 被拒),改用 Edge 免鉴权端点,无需任何 Key/token,国内直连更稳定。本次仅改本地桥,VPK 无变化,老用户重新解压覆盖后运行 restart_bridge.bat 即可。详见 GitHub Release: https://github.com/c1375rick/BabelTower/releases/tag/v1.0.4
```

**勾选文件**: `BabelTower-1.0.4-win64.zip`
