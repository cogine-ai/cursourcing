[![Cursourcing — Your Codex just hired Cursor.](assets/hero.png)](https://github.com/cogine-ai/cursourcing)

<p align="center">
  <strong>Cursor 完成首轮实现与自测，Codex 接管验收与收尾。</strong><br />
  <a href="#安装">安装 Cursourcing</a> ·
  <a href="https://github.com/cogine-ai/marketplace">Cogine AI Marketplace</a> ·
  <a href="README.md">English</a>
</p>

## Astra × Grok，新一代 tokenmaxxing。

**Codex 里的 GPT-6 Astra 快不够用了，Cursor 里的 Grok 4.6 却还有余量。** 让这份余量干起活来。

**Cursourcing = Cursor + outsourcing。** 让 Cursor 里的 Grok 4.6 完成首轮可验收结果，包括调查、实现和自测。Codex 提供约束、处理阻塞决策，在交付后接管验收与局部修正。

你继续在 Codex 里工作。目标是节省 Codex 用量时，减少重复调查和进度查询；实际收益仍取决于任务和审查工作量。

| 阶段 | 负责人 | 工作范围 |
| --- | --- | --- |
| 首轮完整交付 | Cursor | 按约定的约束调查、实现、自测、自修复，并返回证据。 |
| 验收与收尾 | Codex | 审查实际变更，对实质风险独立验证，直接完成局部修正与相关复验。 |

Codex 接管后，默认自行完成局部修正。需要新的调查或大范围返工时，可以再次划定完整单元委派；用户明确指定的方式优先。Cursor 会话继续保留，这是职责划分，不是强制只能执行一轮。

Codex 主模型保持你的选择。当前 Cursor 执行配置为 **Grok 4.6 · xhigh · fast**。

## Token节约效果评测

在 2026-09-17 的本地受控评测中，**Cursourcing 0.2.2（B4）三题合计使用的 Codex token 比纯 Astra（A）减少 43.93%**，节省 1,026,033 token。

两组主模型均为 **GPT-6 Astra · high**。A 由 Astra 独立完成；B4 使用 0.2.2 已提交包的本地快照，让 **Cursor Grok 4.6 · xhigh · fast** 完成首轮实现、自测与证据交付，再由 Astra 验收和局部修正。B4 三题分别在独立新会话中各执行一次，对照此前同题的 A 样本。

| 任务 | A：纯 Astra | B4：Astra + Cursourcing 0.2.2 | Codex token 节省 |
| --- | ---: | ---: | ---: |
| 14 路由 React 网站整体改版 | 1,562,806 | 723,832 | **53.68%** |
| Click 布尔标志默认值缺陷修复 | 385,253 | 309,222 | **19.74%** |
| Tornado DNS resolver 跨文件重构 | 387,808 | 276,780 | **28.63%** |
| **合计** | **2,335,867** | **1,309,834** | **43.93%** |

**统计口径：**表中为实现会话全过程的 Codex 输入与输出 token，包含委派协调、等待、审查和局部修正；缓存读已包含在输入中，推理已包含在输出中，不重复计数。独立启动任务及公共评测准备、外部验收和报告分析开销另计，不包含在表中。节省率为 `(A − B4) / A`，合计按总 token 计算。

**质量与比较条件：**题面、原始 starter、主模型配置及冻结验收保持一致，工作流提示随分工不同；B4 明确由 Astra 接管后续修正。三题均通过冻结功能验收并完成源码或视觉审查：前端通过 14 路由 × 桌面/手机共 28 个检查，Click 和 Tornado 通过独立回归测试。Tornado 的包级类型声明仍遗漏新模块入口，功能通过不代表类型入口完整。

**结果边界：**这是每题一个样本的观察，合计受前端任务权重影响；模型随机性、缓存和服务负载会影响结果，不能保证每次节省相同比例。节省 Codex token 不等于更快或组合总成本更低：本轮两道后端题仍比纯 Astra 慢，Click 的 Codex API 等效费用略高，Cursor 用量未完整返回。原始评测记录暂存本地，尚未随仓库公开。

## 安装

需要支持插件的 Codex、Node.js 22+，以及已安装并登录的 [Cursor CLI](https://cursor.com/docs/cli/overview)。尚未登录时，先运行 `agent login`。Cursor 账号需要能够使用上述 Grok 模型。

### 1. 添加 Cogine AI Marketplace

```bash
codex plugin marketplace add cogine-ai/marketplace
```

如果已经添加，运行 `codex plugin marketplace upgrade cogine-ai` 更新目录。

### 2. 安装 Cursourcing

在 Codex 应用中进入 **Plugins → Cogine AI → Cursourcing** 安装，也可以执行：

```bash
codex plugin add cursourcing@cogine-ai
```

运行文件已打包，安装时无需克隆源码、执行 `npm install` 或构建。

### 3. 用真实任务开始

在项目中新开一个 Codex 任务，引用 **`$cursourcing:cursourcing`**，例如：

```text
使用 $cursourcing 让 Cursor 完成首轮实现与自测，
然后由 Codex 接管验收、局部修正和最终交付。
```

调查和方案探索也可以交给 Cursor，不必先确定每个实现细节。Cursor 执行期间，Codex 处理阻塞或真正独立的工作，将产物审查留到交付后；引用技能不意味着马上委托。

**[浏览 Cogine AI Marketplace 的全部七个插件 →](https://github.com/cogine-ai/marketplace#available-plugins)**

## 给 Cursor 的余量安排点工作

- **范围明确的实现**：按已确定的方案改动相关文件，运行适当检查，汇报结果。
- **带证据的调查**：追踪故障，收集代码与运行证据，交回 Codex 判断。
- **相互独立的工作**：在合适的目录或 worktree 中并行运行多个 Cursor 会话。
- **值得再次委派的工作**：需要新的调查、大范围返工，或你明确要求时，复用原 Cursor 会话继续。

哪些直接完成、哪些交给 Cursor，由 Codex 随任务推进判断。原生子代理和其他协作方式仍然可用。

## 交得出去，也接得回来

| 能力 | 实际体验 |
| --- | --- |
| 异步执行 | Cursor 启动时先返回任务 ID，普通进度留在本地，需要决策或交付时收取结果。 |
| 问题与权限请求 | 请求会返回给 Codex，由它根据已有授权处理，必要时再请你决定。 |
| 精简结果 | 启动和等待默认返回必要状态及未读交付说明，完整详情与原生历史按需加载。 |
| 会话恢复 | 重新加载保存的对话，继续后续工作，不会自动重跑中断前的指令。 |
| 主代理验收与收尾 | Codex 检查交付产物与证据，直接完成局部修正，并复验相关行为。 |

## 常见问题

**额度怎么消耗？** Codex 与 Cursor 各自使用自己的账号和额度，插件在两者之间委托工作，不转移 token。Codex 的规划、跟进和验收仍然消耗额度，实际收益取决于任务和分工。

**一定要用 Astra 吗？** Astra 是这个插件的出发点，主任务仍可使用你选择的其他 Codex 模型。

**会强制所有工作都交给 Cursor 吗？** 不会。技能保持正常可发现，由 Codex 判断何时委托。插件不安装 Hooks，也不禁用原生子代理。

**关闭 Codex 后还能继续跑吗？** 当前版本随 MCP 进程运行。该进程退出时，执行中的任务会中断，保存的会话可以恢复；插件不会独立唤醒空闲的 Codex 任务。

**Cursor 在哪个目录工作？** Codex 传入的绝对目录，也可以是具体 worktree。插件不会自动创建 worktree。

**能改 Cursor 使用的模型吗？** 当前版本固定使用 Grok 4.6、xhigh 和 fast；配置不可用时会明确报错。

## 更新

**0.2.3** 减少日常协调，并补齐中断会话的恢复保护：

- 等待默认延长到 120 秒，MCP 时限为 150 秒；交付和阻塞请求仍提前返回。
- 执行失败先完成进程清理，再返回可处理的失败；插件退出时也清理其持有的 CLI 进程。
- 旧执行仍存活或无法确认结束时，阻止恢复与替代执行；失败摘要明确会话是否存在、能否恢复。
- 技能按决策需要读取进度，本地验收命令采用较长等待。

继续保留 0.2.2 的两阶段职责：Cursor 完成首轮实现、自测和证据交付，Codex 接管验收与局部修正。
执行模型仍为 Grok 4.6 xhigh fast。上方[Token节约效果评测](#token节约效果评测)记录的是 0.2.2（B4），
尚未测量 0.2.3 的新增节省幅度。详见[运行说明](docs/runtime.md)
和[0.2迁移说明](docs/runtime.md#compact-results-and-02-migration)。

```bash
codex plugin marketplace upgrade cogine-ai
codex plugin add cursourcing@cogine-ai
codex plugin list --json
```

确认 Cursourcing 显示版本 `0.2.3`，然后新开任务，以加载最新的技能与工具。

## 更多资料

- [运行机制、权限、配置和历史记录](docs/runtime.md)
- [开发与验证](docs/development.md)
- [图标与分享封面](docs/brand.md)
- [反馈问题或建议](https://github.com/cogine-ai/cursourcing/issues)
- [Cogine AI Marketplace](https://github.com/cogine-ai/marketplace)

## 开源许可

Cursourcing 的原创内容采用 [Apache-2.0](LICENSE) 许可证，版权归 2026 [Cogine AI](https://github.com/cogine-ai) 所有，署名信息见 [NOTICE](NOTICE)。打包的第三方依赖保留各自的许可证，详见 [THIRD_PARTY_NOTICES.md](dist/THIRD_PARTY_NOTICES.md)。

由 [Cogine AI](https://github.com/cogine-ai) 制作。如果你也认识 Codex 先用完、Cursor 还剩不少的朋友，把这个仓库发给他。
