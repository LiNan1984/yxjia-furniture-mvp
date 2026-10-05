let styleInjected = false;
export function injectMarkdownStyle() {
    if (styleInjected || typeof document === 'undefined') {
        return;
    }
    const style = document.createElement('style');
    style.dataset.ynetMarkdown = 'true';
    style.textContent = `
.ynet-md-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#000;line-height:1.65;font-size:16px;box-sizing:border-box}
.ynet-md-root *{box-sizing:border-box}
.ynet-md-block{margin:0 0 14px}
.ynet-md-heading{font-weight:700;color:#111;line-height:1.28;margin:20px 0 12px}
.ynet-md-heading-1{font-size:30px}.ynet-md-heading-2{font-size:25px}.ynet-md-heading-3{font-size:22px}.ynet-md-heading-4{font-size:19px}.ynet-md-heading-5{font-size:17px}.ynet-md-heading-6{font-size:16px}
.ynet-md-paragraph,.ynet-md-list-item{white-space:pre-wrap;overflow-wrap:anywhere}
.ynet-md-list-item{display:flex;gap:8px;align-items:flex-start}
.ynet-md-list-bullet{line-height:1.65;color:#111}
.ynet-md-blockquote{border-left:4px solid #2F7CF6;background:#F4F8FF;color:#24364F;padding:10px 12px;margin:0 0 14px;font-style:italic}
.ynet-md-code-block{background:#F7F7F8;border:1px solid #E6E6E6;border-radius:6px;padding:12px;overflow:auto;font-family:"SFMono-Regular",Consolas,Menlo,monospace;font-size:13px;line-height:1.55;color:#222}
.ynet-md-inline-code{font-family:"SFMono-Regular",Consolas,Menlo,monospace;background:#F1F1F1;border-radius:4px;padding:1px 5px;color:#C7254E;font-size:.92em}
.ynet-md-link{color:#2F7CF6;text-decoration:none}.ynet-md-link:hover{text-decoration:underline}
.ynet-md-divider{height:1px;background:#E3E3E3;margin:18px 0}
.ynet-md-table-wrap{overflow-x:auto;margin:0 0 16px}
.ynet-md-table{border-collapse:collapse;min-width:560px;width:100%;font-size:14px}
.ynet-md-table th,.ynet-md-table td{border:1px solid #E6E6E6;padding:9px 10px;text-align:left;vertical-align:top;color:#000;background:#fff}
.ynet-md-table th{font-weight:700;background:#F8FAFC}
.ynet-md-image{display:block;max-width:100%;border-radius:6px;margin:4px 0 16px;background:#F3F3F3}
.ynet-md-styled-block{padding:10px 12px;margin:0 0 14px;overflow-wrap:anywhere}
.ynet-md-pill{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:999px;padding:0 9px;font-weight:700;line-height:28px;margin:0 2px;vertical-align:middle}
.ynet-md-custom-row{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px;align-items:stretch}
.ynet-md-custom{margin:0 0 14px}
.ynet-md-custom-inline{margin:0;flex:0 0 auto}
.ynet-md-placeholder,.ynet-md-error{border-radius:4px;background:#f3f3f3;min-height:88px;position:relative;overflow:hidden}
.ynet-md-placeholder::after{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 0%,rgba(255,255,255,.55) 45%,transparent 70%);transform:translateX(-100%);animation:ynet-md-shimmer 1.2s linear infinite}
.ynet-md-error{display:flex;align-items:center;padding:12px;color:#B42318;font-size:13px;border:1px solid #F5C2C7}
@keyframes ynet-md-shimmer{to{transform:translateX(100%)}}
.ynet-md-virtual-scroll{height:100%;overflow:auto;contain:content}
.ynet-md-virtual-window{will-change:transform}
`;
    document.head.appendChild(style);
    styleInjected = true;
}
export function colorValue(input, fallback = '#000000') {
    const value = (input ?? '').trim().toLowerCase();
    if (!value) {
        return fallback;
    }
    if (/^#[0-9a-f]{6}$/i.test(value)) {
        return value;
    }
    const map = {
        red: '#FF0000',
        '红': '#FF0000',
        '红色': '#FF0000',
        yellow: '#FFFF00',
        '黄': '#FFFF00',
        '黄色': '#FFFF00',
        blue: '#0000FF',
        '蓝': '#0000FF',
        '蓝色': '#0000FF',
        green: '#008000',
        '绿': '#008000',
        '绿色': '#008000',
        purple: '#800080',
        '紫': '#800080',
        '紫色': '#800080'
    };
    return map[value] ?? fallback;
}
export function pillBackground(input) {
    const value = (input ?? '').trim().toLowerCase();
    if (value === '蓝' || value === '蓝色' || value === 'blue') {
        return '#DBEAFF';
    }
    return '#F3F3F3';
}
//# sourceMappingURL=style.js.map