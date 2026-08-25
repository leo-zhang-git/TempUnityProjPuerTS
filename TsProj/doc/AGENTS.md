# TsProj/doc 文档入口

## 文档职责

- 本目录只承载 TypeScript 代码范围的稳定约束、当前运行时边界和验证规则。
- 模板当前事实由对应 owner 文档定义；根级模板事实仍由 `../../SPECIFICATION.md` 持有。
- 示例 README 只提供局部导航和验证证据，不覆盖本目录 owner。

## Owner 路由

- [runtime-architecture.md](runtime-architecture.md)：模块边界、运行时生命周期、ECS 约束、Unity/PuerTS 接口和模板扩展。
- [coding-conventions.md](coding-conventions.md)：人工编码判断、数据建模、集合与高频路径、错误处理和释放规则。
- [testing.md](testing.md)：静态检查、构建、纯逻辑验证、Unity 联调和变更准入。

## 写作边界

- owner 文档记录当前稳定入口、约束和验收规则，不记录迁移过程、提交状态或临时执行日志。
- 具体字段、局部 API、完整文件清单和可从代码直接确定的细节留在代码和类型定义中。
- 同一事实只保留在真实 owner；其它文档使用链接，不复制另一份解释。
- 仍需判断的技术方案按需进入 `analysis/`，被实现并验证后再写入稳定 owner。

## 维护规则

- 运行时模块边界、依赖方向、PuerTS 导出或生命周期改变时更新 `runtime-architecture.md`。
- 人工编码约束或通用实现模式改变时更新 `coding-conventions.md`。
- 检查入口、测试分层或 Play Mode 验收规则改变时更新 `testing.md`。
- 文档完成后检查本地链接、路径存在性，以及是否错误地把示例结论提升为模板稳定规则。

## 支持资料生命周期

- `analysis/` 保存仍需判断的能力差距、可行性和问题拆分；结论落地后删除过程稿，稳定事实回写 owner。
- `execution/` 保存尚未完成的一次性实施计划；完成、被替代或失真后删除。
- 删除支持资料前确认其中没有尚未迁入 owner 的稳定边界或仍未解决的人工判断项。
