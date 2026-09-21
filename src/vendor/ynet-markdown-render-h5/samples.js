export const COMPLEX_MARKDOWN = `:::thinking
title: 思考中
doneTitle: 思考完成

[[color:蓝|思考中]]，正在拆解 Markdown 样式协议。
- Mock 步骤一：读取三端共享 C++ NodeBatch。
- Mock 步骤二：验证 [[style:color=绿;background=#E8FFF0;fontSize=15|自定义 inline 标签]] 在 custom block 内的表现。
- Mock 步骤三：输出后续 Markdown 内容。
:::

# Markdown 流式渲染综合测试

这是一份三端共享的复杂 Markdown，覆盖标题、段落、强调、链接、列表、引用、表格、代码块、图片占位和自定义组件。

## 基础文本

普通段落需要在流式输入时持续更新，**粗体**、*斜体*、\`inline-code\` 和 [示例链接](https://example.com) 需要保持为同一个文本块内的样式。

## 标题层级

# 一级标题样式
## 二级标题样式
### 三级标题样式
#### 四级标题样式
##### 五级标题样式

---

## 颜色与样式

颜色名需要兼容中文和英文：[[color:红|红色]]、[[color:黄|黄色]]、[[color:蓝|蓝色]]、[[color:绿|绿色]]、[[color:紫|紫色]]。

2025年报显示，茅台酒收入为1465.00亿元，占总营业收入比例为85.15%，毛利率为93.53%。[[pill:蓝|1]] [[pill:蓝|2]] [[pill:蓝|3]]

:::style
color: 紫
background: #F3E8FF
radius: 12
fontSize: 17

这是一个独立的 style block，用于验证文字颜色、背景色、圆角和字号。
:::

> 这是一段引用内容。
> 引用节点在空行结束后应该变成 stable。

- 第一条列表内容
- 第二条列表内容，包含 \`code\`
- 第三条列表内容，包含较长文本用于观察换行效果

## 表格

| 指标 | Android | iOS | Harmony |
| --- | ---: | ---: | ---: |
| 首字显示 | [[color:绿|80ms]] | [[color:绿|75ms]] | [[color:红|90ms]] |
| 刷新间隔 | [[color:蓝|50ms]] | [[color:蓝|50ms]] | [[color:蓝|50ms]] |
| 单次刷新 | [[color:绿|3ms]] | [[color:绿|3ms]] | [[color:黄|4ms]] |

## 代码块

\`\`\`cpp
MarkdownStreamEngine engine;
engine.Append("# title\\n\\n");
std::string batch = engine.SnapshotJson();
\`\`\`

## 图片占位

![真实图片验证](https://gips0.baidu.com/it/u=1690853528,2506870245&fm=3028&app=3028&f=JPEG&fmt=auto?w=1024&h=1024)

## 自定义雷达图

:::radar-chart
title: 三端能力评分
labels: 解析,渲染,流式,扩展,性能
values: 92,88,95,86,90
delayMs: 450
:::

## 账单概览

:::stat-cards
title: 账单概览
primary: 总支出|¥36512.39
items: 消费支出|¥36486.39,非消费支出|¥26.00,交易笔数|412笔
:::

2026-01-01 至 2026-06-25 期间，你共支出 ¥36512.39，其中消费支出 ¥36486.39，非消费支出 ¥26.00，共 412 笔交易，平均单笔支出 ¥89.93。存在一笔 ¥3950.40 的大额支出，类别为娱乐休闲。分类占比最高的是交通出行，金额 ¥12938.18。

### 支出结构分析

:::donut-chart
title: 分类支出占比
labels: 交通出行,娱乐休闲,收入,餐饮,购物
values: 12938.18,12623.90,6059.18,4685.61,3260.74
percentages: 30.39,29.65,14.23,11.01,7.66
:::

分类占比图中最高的是交通出行，金额 ¥12938.18，占比 30.39%，共 136 笔交易。其次是娱乐休闲，金额 ¥12623.90，占比 29.65%。餐饮支出 ¥4685.61，占比 11.01%，交易笔数最多达 172 笔。购物支出 ¥3260.74，占比 7.66%。

### 消费特点

周期内存在一笔金额较高的单笔支出 ¥3950.40，类别为娱乐休闲，商户为汉庭星空（上海）酒店管理有限公司。建议确认是否属于一次性支出，避免干扰日常消费判断。

- 查看大额支出明细
- 看看分类占比

## 自定义动画

:::animation
title: 流式输出动画
kind: pulse
color: #2F7CF6
delayMs: 600
:::

## 一行多个自定义组件

:::radar-chart
title: 小型雷达图
labels: 解析,渲染,复用
values: 92,88,90
$display: inline
$width: 156
$height: 210
delayMs: 300
:::

:::animation
title: 小型动画
kind: pulse
color: #E85D75
$display: inline
$width: 156
$height: 210
delayMs: 300
:::

## 收尾段落

最后一个段落用于验证普通完整渲染与流式渲染在稳定节点上的表现一致。
`;
export function createLongMarkdown() {
    let markdown = '# 超长 Markdown 渲染测试\n\n';
    for (let index = 1; index <= 80; index += 1) {
        markdown += `## 第 ${index} 组内容\n\n`;
        markdown += `这是第 ${index} 组长文档段落，用于触发节点级虚拟化或降级渲染策略。`;
        markdown += '每组都包含列表、引用和表格，方便观察滚动、复用和局部刷新是否稳定。\n\n';
        markdown += `- 长文档列表 A-${index}\n`;
        markdown += `- 长文档列表 B-${index}\n`;
        markdown += `> 第 ${index} 组引用内容，验证引用节点样式。\n\n`;
        if (index % 10 === 0) {
            markdown += ':::animation\n';
            markdown += `title: 第 ${index} 组异步动画\n`;
            markdown += 'kind: pulse\n';
            markdown += 'delayMs: 300\n';
            markdown += ':::\n\n';
        }
    }
    return markdown;
}
//# sourceMappingURL=samples.js.map