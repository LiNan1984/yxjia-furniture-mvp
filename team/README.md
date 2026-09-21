# Agent Team · 工作区（银杏家具 MVP）

> 由 /loop 驱动的 4 角色虚拟团队。每个角色一轮迭代，通过本目录交接成果。

## 角色

| 角色 | 目录 | 职责 |
|------|------|------|
| 营销 M | `team/marketing/` | 挖掘客户痛点（分析店内数据 + 外部调研），输出 `insights-vN.md` |
| 产品 P | `team/spec/` | 依据痛点写/更新 spec 开发文档，输出 `spec-vN.md` |
| 测试 Q | `team/qa/` | 依据 spec 写测试案例，输出 `testcases-vN.md` |
| 开发 D | `team/dev/` | 按 spec + 测试案例实现代码，写 `dev-log-vN.md`，跑通测试 |

## 迭代流程（每轮 = 一个版本 vN）

1. **M** 读 `team/STATE.md` + 前轮反馈 → 输出痛点洞察
2. **P** 读洞察 → 选定本版功能 → 写 spec
3. **Q** 读 spec → 写测试案例（先行）
4. **D** 按测试案例 TDD 实现 → 跑测试 → 写 dev-log
5. 主控更新 `STATE.md`（版本号 + 状态 + 下轮建议）

## 规则

- 遵守 CLAUDE.md 设计原则（两色调、无前端框架、无数据库、JSON 存储）
- **不执行 git commit/push**，改动留在工作区由老板审阅
- 测试跑法见 CLAUDE.md 第 10 节（Playwright Node + Python）
- 对接 `docs/AI能力调研.md` 的能力路线图

## 状态

见 `team/STATE.md`
