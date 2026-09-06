/**
 * AI 识别管理器（OCR + 账单解析 + 智能分类）
 * ----------------------------------------------------------------
 * 来源文件：js/app.js
 * 拆分范围：原 app.js 第 2276 行 ~ 第 3003 行
 * 拆分说明：从单体脚本 app.js 中按对象真实边界提取 AIRecognition 对象，
 *          转为 ES Module 以便按需加载与按依赖注入。
 *          保留原代码完全一致，仅在尾部追加 export default。
 * 注意：该文件依赖若干全局工具（api、fetch、XLSX、URL、Image、Canvas、
 *       showToast、escapeHtml、cache、getCat、resolveCategoryId 等），
 *       这些依赖由调用方在使用前注入/确保可用。
 * ----------------------------------------------------------------
 */

const AIRecognition = {
    parsedItems: [],
    selectedFile: null,
    compressedFile: null,
    billFile: null,
    hasProvider: null,

    async checkProvider() {
        if (this.hasProvider !== null) return this.hasProvider;
        try {
            const res = await api('/ai/providers');
            this.hasProvider = res && Array.isArray(res.providers) && res.providers.length > 0;
        } catch (err) {
            this.hasProvider = false;
        }
        return this.hasProvider;
    },

    renderNoProvider(containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `<div class="empty-hint"><p>${escapeHtml(tt('aiRec.noProvider', '未配置 AI 服务商'))}</p><button class="btn btn-ghost btn-ai" style="margin-top:12px" data-goto-ai-config>${escapeHtml(tt('aiRec.gotoConfig', '前往 AI 配置'))}</button></div>`;
            // 用事件委托绑定跳转，避免 inline onclick 在某些环境下不生效
            container.querySelector('[data-goto-ai-config]')?.addEventListener('click', () => window.switchPage && window.switchPage('ai-config'));
        }
    },

    init() {
        const firstEl = document.getElementById('ocrRecognizeBtn');
        if (!firstEl) return;  // ai-recognition 页面通过 PageLoader 惰加载
        this._bindEvents();
    },

    // 懒加载时 init 可能错过，refresh 时补上事件绑定
    refresh() {
        const firstEl = document.getElementById('ocrRecognizeBtn');
        if (firstEl && !this._eventsBound) {
            this._bindEvents();
        }
    },

    _bindEvents() {
        this._eventsBound = true;

        // OCR 上传
        const uploadArea = document.getElementById('ocrUploadArea');
        const fileInput = document.getElementById('ocrImageInput');
        const recognizeBtn = document.getElementById('ocrRecognizeBtn');

        uploadArea.addEventListener('click', () => { if (!this.selectedFile) fileInput.click(); });
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
        uploadArea.addEventListener('drop', (e) => { e.preventDefault(); uploadArea.classList.remove('drag-over'); this.handleFile(e.dataTransfer.files[0]); });
        fileInput.addEventListener('change', (e) => { if (e.target.files[0]) this.handleFile(e.target.files[0]); });
        recognizeBtn.addEventListener('click', () => this.ocrRecognize());
        document.getElementById('ocrClearBtn').addEventListener('click', () => this.ocrClear());
        const retransBtn = document.getElementById('ocrRetranscribeBtn');
        if (retransBtn) retransBtn.addEventListener('click', () => this.ocrRetranscribe());

        // 账单导入
        const billArea = document.getElementById('billUploadArea');
        const billInput = document.getElementById('billFileInput');
        const billParseBtn = document.getElementById('billParseBtn');
        billArea.addEventListener('click', () => { if (!this.billFile) billInput.click(); });
        billArea.addEventListener('dragover', (e) => { e.preventDefault(); billArea.classList.add('drag-over'); });
        billArea.addEventListener('dragleave', () => billArea.classList.remove('drag-over'));
        billArea.addEventListener('drop', (e) => { e.preventDefault(); billArea.classList.remove('drag-over'); this.handleBillFile(e.dataTransfer.files[0]); });
        billInput.addEventListener('change', (e) => { if (e.target.files[0]) this.handleBillFile(e.target.files[0]); });
        billParseBtn.addEventListener('click', () => this.parseBill());
        document.getElementById('billClearBtn').addEventListener('click', () => this.billClear());

        // 账单导入结果的「全部导入」（OCR 结果已走 AISmartEntry 确认区，不经此按钮）
        const importAllBtn = document.getElementById('aiImportAllBtn');
        if (importAllBtn) importAllBtn.addEventListener('click', () => this.importAll());
    },

    handleFile(file) {
        if (!file || !file.type.startsWith('image/')) { showToast(tt('aiRec.selectImage', '请选择图片文件'), 'warning'); return; }
        if (file.size > 10 * 1024 * 1024) { showToast(tt('aiRec.imageTooLarge', '图片不能超过 10MB'), 'warning'); return; }
        this.selectedFile = file;
        const url = URL.createObjectURL(file);
        document.getElementById('ocrPreview').src = url;
        document.getElementById('ocrPreview').style.display = 'block';
        document.getElementById('ocrUploadPlaceholder').style.display = 'none';
        document.getElementById('ocrRecognizeBtn').disabled = false;

        // 后台压缩：大图片先压缩再上传（Tunnel 上传限速，压缩后从 2MB→100KB 提效 20 倍）
        this.compressForUpload(file);
    },

    // Canvas 压缩图片（限制宽度 1024px，质量 0.7，预计压缩比 10-20 倍）
    async compressForUpload(file) {
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = URL.createObjectURL(file);
            });
            const maxW = 1024, maxH = 1024;
            let w = img.width, h = img.height;
            if (w > maxW) { h = h * maxW / w; w = maxW; }
            if (h > maxH) { w = w * maxH / h; h = maxH; }

            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
            this.compressedFile = new File([blob], 'ocr_compressed.jpg', { type: 'image/jpeg' });
            console.log('OCR compress:', (file.size / 1024).toFixed(0) + 'KB → ' + (blob.size / 1024).toFixed(0) + 'KB');
        } catch (e) {
            // 压缩失败则使用原图
            this.compressedFile = file;
        }
    },

    ocrClear() {
        const preview = document.getElementById('ocrPreview');
        if (preview.src && preview.src.startsWith('blob:')) {
            URL.revokeObjectURL(preview.src);
        }
        this.selectedFile = null;
        this.compressedFile = null;
        preview.style.display = 'none';
        preview.src = '';
        document.getElementById('ocrUploadPlaceholder').style.display = 'block';
        document.getElementById('ocrRecognizeBtn').disabled = true;
        document.getElementById('ocrImageInput').value = '';
        // 图没了，「换腾讯 OCR 重试」也无从谈起；转录文字一并收起
        const retransBtn = document.getElementById('ocrRetranscribeBtn');
        if (retransBtn) retransBtn.style.display = 'none';
        const tp = document.getElementById('ocrTextPreview');
        if (tp) { tp.style.display = 'none'; tp.textContent = ''; }
    },

    // ====== 账单导入 ======
    handleBillFile(file) {
        if (!file) return;
        const validExts = ['.csv', '.xls', '.xlsx'];
        const name = file.name.toLowerCase();
        if (!validExts.some(ext => name.endsWith(ext))) {
            showToast(tt('aiRec.onlyCsvXls', '仅支持 CSV / XLS / XLSX 格式'), 'warning'); return;
        }
        this.billFile = file;
        document.getElementById('billFileInfo').style.display = 'block';
        document.getElementById('billUploadPlaceholder').style.display = 'none';
        document.getElementById('billFileName').textContent = file.name;
        document.getElementById('billFileMeta').textContent = `${(file.size / 1024).toFixed(1)} KB`;
        document.getElementById('billParseBtn').disabled = false;
    },

    billClear() {
        this.billFile = null;
        document.getElementById('billFileInfo').style.display = 'none';
        document.getElementById('billUploadPlaceholder').style.display = 'block';
        document.getElementById('billParseBtn').disabled = true;
        document.getElementById('billFileInput').value = '';
    },

    async parseBill() {
        if (!this.billFile) return;
        const btn = document.getElementById('billParseBtn');
        btn.disabled = true;
        btn.textContent = tt('aiRec.parsing', '解析中...');
        document.getElementById('aiResults').style.display = 'none';

        try {
            const name = this.billFile.name.toLowerCase();
            const isCsv = name.endsWith('.csv');
            if (!isCsv) {
                // XLS/XLSX：按需动态加载 xlsx.full.min.js（未在 index.html 预载，避免无用 preload 警告）
                if (typeof XLSX === 'undefined') {
                    await new Promise((resolve, reject) => {
                        const s = document.createElement('script');
                        s.src = 'js/vendor/xlsx.full.min.js';
                        s.onload = resolve;
                        s.onerror = () => reject(new Error(tt('aiRec.xlsxLoadFail', 'xlsx.full.min.js 加载失败')));
                        document.head.appendChild(s);
                    });
                }
            }
            const buf = await this.billFile.arrayBuffer();

            let rows;
            if (isCsv) {
                // CSV：自动检测编码（UTF-8 或 GBK），文本解析保留原始格式
                let text;
                try {
                    text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buf));
                } catch (e) {
                    // UTF-8 解码失败，尝试 GBK
                    text = new TextDecoder('gbk').decode(new Uint8Array(buf));
                }
                rows = text.split(/\r?\n/).map(line => {
                    const result = [];
                    let current = '', inQuote = false;
                    for (const ch of line) {
                        if (ch === '"') { inQuote = !inQuote; }
                        else if ((ch === ',' || ch === '\t') && !inQuote) { result.push(current.trim()); current = ''; }
                        else { current += ch; }
                    }
                    result.push(current.trim());
                    return result;
                });
            } else {
                // Excel：XLSX 解析，保留原始日期格式并自动转换时区
                const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true, cellNF: true });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                // 获取最大行列范围，确保每行长度一致
                const range = XLSX.utils.decode_range(sheet['!ref']);
                const cols = range.e.c - range.s.c + 1;
                rows = [];
                for (let r = range.s.r; r <= range.e.r; r++) {
                    const row = [];
                    for (let c = range.s.c; c <= range.e.c; c++) {
                        const cellRef = XLSX.utils.encode_cell({ r, c });
                        const cell = sheet[cellRef];
                        if (!cell) { row.push(''); continue; }
                        // 优先使用格式化文本（w），它能保持日期/时间格式
                        row.push(cell.w != null ? cell.w : cell.v);
                    }
                    rows.push(row);
                }
            }

            if (!rows || rows.length < 2) throw new Error(tt('aiRec.billEmpty', '账单文件为空或格式不正确'));

            const { headerRow, format } = this.detectBillFormat(rows);
            const items = this.parseBillRows(rows, headerRow, format, isCsv);
            if (items.length === 0) throw new Error(tt('aiRec.billNoTxn', '未能从账单中识别到交易记录，请确认文件格式'));

            this.parsedItems = items;
            this.renderBillResults();
            showToast(tt('aiRec.parseOk', '解析 {n} 条记录（{format}）').replace('{n}', String(items.length)).replace('{format}', format), 'success');
        } catch (err) {
            showToast(err.message || tt('aiRec.parseFail', '解析失败'), 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = tt('aiRec.parseBtn', '解析账单');
        }
    },

    // 自动检测支付宝/微信账单格式
    detectBillFormat(rows) {
        // 查找表头行（前 25 行内，账单前面有元数据）
        for (let i = 0; i < Math.min(25, rows.length); i++) {
            const line = rows[i].map(c => String(c == null ? '' : c).trim());
            const joined = line.join(',').toLowerCase();

            // 微信格式：交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
            if (joined.includes('交易时间') && joined.includes('交易类型') && joined.includes('收/支')) {
                return { headerRow: i, format: '微信' };
            }
            // 支付宝格式：交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注
            if (joined.includes('交易时间') && joined.includes('交易分类') && joined.includes('收/支')) {
                return { headerRow: i, format: '支付宝' };
            }
            // 兜底：包含交易时间和收/支
            if (joined.includes('交易时间') && joined.includes('收/支') && joined.includes('交易对方')) {
                return { headerRow: i, format: '支付宝' };
            }
            // 通用格式
            if (line.some(c => /date|日期|时间/.test(c.toLowerCase())) && line.some(c => /amount|金额/.test(c.toLowerCase()))) {
                return { headerRow: i, format: '通用' };
            }
        }
        return { headerRow: -1, format: '无表头' };
    },

    parseBillRows(rows, headerRow, format, isCsv) {
        const items = [];
        const seen = new Set();

        // 从 cell 提取日期时间（Excel 已格式化为字符串，CSV 为原始文本）
        function extractDate(cellVal, rowObj) {
            const str = String(cellVal || '').trim();
            // 支付宝/微信常见格式：2026-07-19 17:17:59 或 2026-07-10 16:02:37
            const dtm = str.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
            if (dtm) {
                return `${dtm[1]}-${dtm[2].padStart(2, '0')}-${dtm[3].padStart(2, '0')} ${dtm[4].padStart(2, '0')}:${dtm[5].padStart(2, '0')}:${dtm[6].padStart(2, '0')}`;
            }
            // 只有日期：2026-07-19
            const dm = str.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
            if (dm) return `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')} 00:00:00`;
            // 兜底：如果是数字序列号（极少情况）
            const raw = rowObj[timeCol];
            if (typeof raw === 'number') {
                const n = parseFloat(raw);
                if (!isNaN(n) && n > 40000) {
                    const totalDays = n - 25569;
                    const days = Math.floor(totalDays);
                    const timeFraction = totalDays - days;
                    const d = new Date(Date.UTC(1970, 0, 1 + days));
                    const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0');
                    let totalSec = Math.round(timeFraction * 86400) + 8 * 3600;
                    if (totalSec >= 86400) totalSec -= 86400;
                    const h = String(Math.floor(totalSec / 3600) % 24).padStart(2, '0');
                    const min = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
                    const s = String(totalSec % 60).padStart(2, '0');
                    return `${y}-${m}-${day} ${h}:${min}:${s}`;
                }
            }
            return null;
        }

        const header = headerRow >= 0 ? rows[headerRow].map(c => String(c == null ? '' : c).trim()) : [];
        const colIdx = name => header.findIndex(h => h.includes(name));

        // 列索引映射
        let timeCol, nameCol, noteCol, amtCol, typeCol, statusCol, payCol;
        if (format === '支付宝') {
            timeCol = 0; nameCol = colIdx('交易对方'); noteCol = colIdx('商品说明');
            amtCol = colIdx('金额'); typeCol = colIdx('收/支'); statusCol = colIdx('交易状态');
            payCol = colIdx('收/付款方式');
        } else if (format === '微信') {
            timeCol = 0; nameCol = colIdx('交易对方'); noteCol = colIdx('商品');
            amtCol = colIdx('金额'); typeCol = colIdx('收/支'); statusCol = colIdx('当前状态');
            payCol = colIdx('支付方式');
        } else {
            timeCol = colIdx('date') >= 0 ? colIdx('date') : colIdx('日期') >= 0 ? colIdx('日期') : colIdx('时间');
            nameCol = colIdx('name') >= 0 ? colIdx('name') : colIdx('对方') >= 0 ? colIdx('对方') : colIdx('商户');
            noteCol = colIdx('note') >= 0 ? colIdx('note') : colIdx('说明') >= 0 ? colIdx('说明') : colIdx('商品');
            amtCol = colIdx('amount') >= 0 ? colIdx('amount') : colIdx('金额');
            typeCol = colIdx('type') >= 0 ? colIdx('type') : colIdx('类型') >= 0 ? colIdx('类型') : colIdx('收支');
            statusCol = colIdx('status') >= 0 ? colIdx('status') : colIdx('状态');
            payCol = colIdx('method') >= 0 ? colIdx('method') : colIdx('pay') >= 0 ? colIdx('pay') : colIdx('方式') >= 0 ? colIdx('方式') : colIdx('支付');
        }

        // 根据支付宝/微信支付方式匹配用户的账户
        const accounts = cache.accounts || [];
        function matchAccount(payMethod) {
            if (!payMethod || payMethod === '/') return null;
            const pm = payMethod.toLowerCase().replace(/\([^)]*\)/g, '').replace(/&.*/, '').trim();
            // 关键字映射
            const map = [
                { kw: ['花呗'], target: '花呗' },
                { kw: ['借呗'], target: '借呗' },
                { kw: ['余额宝'], target: '余额宝' },
                { kw: ['零钱','微信零钱'], target: '微信零钱' },
                { kw: ['零钱通'], target: '零钱通' },
                { kw: ['工商','工行','icbc'], target: '工商' },
                { kw: ['招商','招行','cmb'], target: '招商' },
                { kw: ['建设','建行','ccb'], target: '建设' },
                { kw: ['农业','农行','abc'], target: '农业' },
                { kw: ['中国银行','中行','boc'], target: '中国银行' },
                { kw: ['交通','交行','bcm'], target: '交通' },
                { kw: ['邮储','邮政'], target: '邮储' },
                { kw: ['平安'], target: '平安' },
                { kw: ['中信'], target: '中信' },
                { kw: ['浦发'], target: '浦发' },
                { kw: ['民生'], target: '民生' },
                { kw: ['兴业'], target: '兴业' },
                { kw: ['光大'], target: '光大' },
                { kw: ['华夏'], target: '华夏' },
                { kw: ['广发'], target: '广发' },
                { kw: ['信用卡'], target: '信用卡' },
                { kw: ['储蓄','借记'], target: '储蓄' },
            ];
            for (const m of map) {
                for (const kw of m.kw) {
                    if (pm.includes(kw)) {
                        // 在用户账户中按名称匹配
                        const acc = accounts.find(a => a.name.includes(m.target));
                        if (acc) return acc.id;
                    }
                }
            }
            // 直接按支付方式名找账户
            for (const a of accounts) {
                if (pm.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(pm)) return a.id;
            }
            return null;
        }

        const dataRows = headerRow >= 0 ? rows.slice(headerRow + 1) : rows;

        for (const row of dataRows) {
            if (!row || row.length === 0) continue;
            const cells = row.map(c => String(c == null ? '' : c).trim());
            if (cells.every(c => !c)) continue;

            // 跳过元数据/分隔行
            const firstCell = cells[0] || '';
            if (/合计|总计|汇总|total|----/.test(firstCell)) continue;
            if (/^\d{20,}$/.test(firstCell)) continue;

            // 提取字段
            const name = nameCol >= 0 && nameCol < cells.length ? cells[nameCol] : '';
            const note = noteCol >= 0 && noteCol < cells.length ? cells[noteCol] : '';
            const typeStr = typeCol >= 0 && typeCol < cells.length ? cells[typeCol] : '';
            const statusStr = statusCol >= 0 && statusCol < cells.length ? cells[statusCol] : '';

            // 跳过中性交易（收/支为 / 或 不计收支）
            if (typeStr === '/' || typeStr === '' || typeStr === '不计收支') continue;
            if (!name || name === '/') continue;
            // 跳过非成功交易
            if (statusStr && !/成功|支付成功|交易成功|已入账|已转账|已存入/i.test(statusStr)) continue;

            // 解析金额（CSV 字符串，Excel 可能是数字）
            let amount = NaN;
            if (amtCol >= 0 && amtCol < row.length) {
                const rawAmt = row[amtCol];
                if (typeof rawAmt === 'number') amount = rawAmt;
                else amount = parseFloat(String(rawAmt).replace(/[¥￥,\s]/g, ''));
            }
            if (isNaN(amount) || amount <= 0) continue;

            // 判断类型
            const isIncome = /收入|入账|退款/i.test(typeStr);
            const type = isIncome ? 'income' : 'expense';

            // 解析日期时间
            let date = fmtDateTime(new Date());
            if (isCsv) {
                const dateStr = String(cells[timeCol] || '').trim();
                // 匹配完整时间：2026-07-19 17:17:59
                const dtm = dateStr.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
                if (dtm) {
                    date = `${dtm[1]}-${dtm[2].padStart(2, '0')}-${dtm[3].padStart(2, '0')} ${dtm[4].padStart(2, '0')}:${dtm[5].padStart(2, '0')}:${dtm[6].padStart(2, '0')}`;
                } else {
                    const dm = dateStr.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
                    if (dm) date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')} 00:00:00`;
                }
            } else {
                const parsedDate = extractDate(cells[timeCol], row);
                if (parsedDate) date = parsedDate;
            }

            // 去重
            const key = `${name}|${amount.toFixed(2)}|${date}`;
            if (seen.has(key)) continue;
            seen.add(key);

            // 提取支付方式并匹配账户
            const payMethod = payCol >= 0 && payCol < cells.length ? cells[payCol] : '';
            const matchedAccId = matchAccount(payMethod);

            // 分类匹配
            const catId = this.resolveCategoryId(null, name + ' ' + note);
            const cat = getCat(catId);

            items.push({
                name: name.slice(0, 50),
                amount,
                type,
                date,
                note: note === '/' || !note ? name : note,
                category: cat.name || '其他',
                account_id: matchedAccId || undefined
            });
        }
        return items;
    },

    /* ====== 图片记账（POST /ai/ocr 与 /ai/ocr/retranscribe）======
     * 两个端点的请求形态（multipart 单图）与响应契约（v0.2 预测快照）完全一致，
     * 差别仅在 URL、按钮态与文案，故收敛到本方法，由 ocrRecognize / ocrRetranscribe 传参。
     *
     * 结果一律交给 AISmartEntry._loadExternal() 进 v0.2 确认区 —— 图片通道不再自建
     * 编辑表格，与文本/语音通道共用同一套确认、修正、原子 commit 与学习信号链路。
     */
    async _ocrRequest({ path, btnId, noTxnKey, noTxnText, failKey, failText, okToast }) {
        if (!(await this.checkProvider())) {
            showToast(tt('aiRec.providerNeeded', '未配置 AI 服务商，请前往 AI 配置'), 'warning');
            return;
        }
        const btn = document.getElementById(btnId);
        if (btn) btn.disabled = true;
        document.getElementById('ocrLoading').style.display = 'block';

        try {
            const formData = new FormData();
            formData.append('image', this.compressedFile || this.selectedFile);
            // 自动带上「上次使用的账户」作兜底：
            //   OCR 文本里如果没有「支付宝/微信/银行」等渠道关键词（如账单详情页），
            //   后端 resolveAccount 会退到 fallback_default 路径并写入该账户，
            //   识别依据里同时显示「上次使用：XXX」。
            try {
                const lastAccountId = localStorage.getItem('xinwallet.last_account_id');
                const lastAccountName = localStorage.getItem('xinwallet.last_account_name');
                if (lastAccountId) formData.append('account_id', String(lastAccountId));
                if (lastAccountName) formData.append('account_name', String(lastAccountName));
            } catch (_) { /* localStorage 不可用时静默跳过 */ }

            // 走裸 fetch 而非 api()：这是 multipart 上传，api() 固定发 JSON
            const token = localStorage.getItem('xin_token');
            const res = await fetch(`${API}${path}`, {
                method: 'POST',
                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                body: formData
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || tt(failKey, failText));
            const payload = data.data || {};

            // 转录出的原文始终展示，识别不出交易时用户可据此判断是图糊了还是解析漏了
            if (payload.text) {
                const tp = document.getElementById('ocrTextPreview');
                tp.textContent = payload.text;
                tp.style.display = 'block';
            }
            if (payload.reason) showToast(payload.reason, 'warning');

            // 识别过一次后才给出「换腾讯 OCR 重试」入口（识别不出交易时同样可能想换引擎重来）
            const retransBtn = document.getElementById('ocrRetranscribeBtn');
            if (retransBtn) retransBtn.style.display = 'inline-block';

            if (payload.prediction_id && Array.isArray(payload.transactions) && payload.transactions.length) {
                await AISmartEntry._loadExternal(payload, { emptyHint: tt(noTxnKey, noTxnText) });
                // 确认区在页面另一处，滚过去让用户一眼看到结果
                const confirmEl = document.getElementById('aiSmartConfirm');
                if (confirmEl) confirmEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (okToast) showToast(okToast, 'success');
            } else {
                showToast(tt(noTxnKey, noTxnText), 'warning');
            }
        } catch (err) {
            showToast(err.message || tt(failKey, failText), 'error');
        } finally {
            document.getElementById('ocrLoading').style.display = 'none';
            if (btn) btn.disabled = false;
        }
    },

    async ocrRecognize() {
        if (!this.selectedFile) return;
        document.getElementById('ocrTextPreview').style.display = 'none';
        await this._ocrRequest({
            path: '/ai/ocr',
            btnId: 'ocrRecognizeBtn',
            noTxnKey: 'aiRec.noTxn', noTxnText: '未能识别到交易项',
            failKey: 'aiRec.recognizeFail', failText: '识别失败',
        });
    },

    // 用户反馈「识别有误」时调用：强制走腾讯 OCR 引擎重新识别同一张图
    async ocrRetranscribe() {
        if (!this.selectedFile) { showToast(tt('aiRec.uploadFirst', '请先上传图片'), 'warning'); return; }
        await this._ocrRequest({
            path: '/ai/ocr/retranscribe',
            btnId: 'ocrRetranscribeBtn',
            noTxnKey: 'aiRec.rerecognizeNoTxn', noTxnText: '重识别仍未识别到交易项',
            failKey: 'aiRec.rerecognizeFail', failText: '重识别失败',
            okToast: tt('aiRec.tencentOcrDone', '腾讯 OCR 重新识别完成'),
        });
    },

    renderBillResults() {
        // ⚠️ 仅账单（CSV/XLSX）用。OCR 已统一走 AISmartEntry._loadExternal() 复用 v0.2 确认区。
        //    账单是用户已确认的导出文件，前端解析精度足够，无须再走 AI 裁决。
        document.getElementById('aiResults').style.display = 'block';
        const cats = cache.categories || [];
        const expenseCats = cats.filter(c => c.type === 'expense');
        const incomeCats = cats.filter(c => c.type === 'income');
        const accounts = cache.accounts || [];

        // 默认账户：优先用已设置的，否则第一个活跃账户
        const defaultAccId = accounts.length > 0 ? accounts[0].id : null;

        document.getElementById('aiResultsList').innerHTML = this.parsedItems.map((item, i) => {
            const isIncome = item.type === 'income';
            const catList = isIncome ? incomeCats : expenseCats;
            const rawDate = item.date || fmtDateTime(new Date());
            const dateVal = typeof rawDate === 'string' ? rawDate.slice(0, 19).replace(' ', 'T') : rawDate;
            const accId = item.account_id || defaultAccId;

            return `<div class="ai-edit-row" data-idx="${i}">
                <div class="ai-edit-col ai-edit-acc">
                    <select class="ai-edit-acc-sel" data-field="account" data-idx="${i}">
                        ${accounts.map(a => `<option value="${a.id}" ${a.id === accId ? 'selected' : ''}>${escapeHtml(a.icon || "🏦")} ${escapeHtml(a.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="ai-edit-col ai-edit-type">
                    <select class="ai-edit-type-sel" data-field="type" data-idx="${i}">
                        <option value="expense" ${!isIncome ? 'selected' : ''}>${escapeHtml(tt('aiRec.type.expense', '支出'))}</option>
                        <option value="income" ${isIncome ? 'selected' : ''}>${escapeHtml(tt('aiRec.type.income', '收入'))}</option>
                    </select>
                </div>
                <div class="ai-edit-col ai-edit-cat">
                    <select class="ai-edit-cat-sel" data-field="category" data-idx="${i}">
                        ${catList.map(c => `<option value="${c.id}" data-name="${escapeHtml(c.name)}" data-icon="${escapeHtml(c.icon || "📌")}" ${(item.category_id === c.id || item.category === c.name) ? 'selected' : ''}>${c.icon || '📌'} ${escapeHtml(c.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="ai-edit-col ai-edit-amt">
                    <input class="ai-edit-amt-inp" type="number" step="0.01" min="0.01" value="${parseFloat(item.amount || 0).toFixed(2)}" data-field="amount" data-idx="${i}">
                </div>
                <div class="ai-edit-col ai-edit-date">
                    <input class="ai-edit-date-inp" type="datetime-local" step="1" value="${dateVal}" data-field="date" data-idx="${i}">
                </div>
                <div class="ai-edit-col ai-edit-note">
                    <input class="ai-edit-note-inp" type="text" value="${escapeHtml(item.note || item.name || '')}" placeholder="${tt('aiRec.notePlaceholder', '备注')}" data-field="note" data-idx="${i}">
                </div>
                <div class="ai-edit-col ai-edit-del">
                    <button class="ai-edit-del-btn" data-idx="${i}" title="删除此行">✕</button>
                </div>
            </div>`;
        }).join('');

        // 事件绑定：输入/选择变更 → 更新 parsedItems
        document.querySelectorAll('#aiResultsList [data-field]').forEach(el => {
            el.addEventListener('change', () => {
                const idx = parseInt(el.dataset.idx);
                const field = el.dataset.field;
                const val = el.value;
                if (field === 'amount') this.parsedItems[idx].amount = parseFloat(val) || 0;
                else if (field === 'date') this.parsedItems[idx].date = val;
                else if (field === 'note') this.parsedItems[idx].note = val;
                else if (field === 'account') this.parsedItems[idx].account_id = parseInt(val);
                else if (field === 'type') {
                    this.parsedItems[idx].type = val;
                    // 切换类型后刷新整行（分类列表变了）
                    this.renderBillResults();
                }
                else if (field === 'category') {
                    const sel = el.options[el.selectedIndex];
                    this.parsedItems[idx].category = sel.dataset.name;
                    this.parsedItems[idx].category_id = parseInt(val);
                    // 更新显示的分类标签颜色
                    const row = el.closest('.ai-edit-row');
                    if (row) {
                        const catSel = row.querySelector('.ai-edit-cat-sel');
                        if (catSel) catSel.style.color = val > 0 ? 'var(--accent-500)' : '';
                    }
                }
            });
        });

        // 删除按钮
        document.querySelectorAll('#aiResultsList .ai-edit-del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                this.parsedItems.splice(idx, 1);
                if (this.parsedItems.length === 0) {
                    document.getElementById('aiResults').style.display = 'none';
                } else {
                    this.renderBillResults();
                }
            });
        });
    },

    // 批量把解析后的账单行导入为交易（账单是用户已确认的导出文件，前端解析精度足够，不走 AI 裁决）
    async importAll() {
        if (this.parsedItems.length === 0) return;
        const accountId = cache.accounts[0]?.id;
        if (!accountId) { showToast(tt('aiRec.needAccount', '请先创建账户'), 'error'); return; }

        const tasks = this.parsedItems
            .filter(item => parseFloat(item.amount) > 0)
            .map(item => {
                const catId = item.category && item.category.id ? item.category.id
                    : this.resolveCategoryId(item.category, item.name);
                const itemAccId = item.account_id || cache.accounts[0]?.id;
                return api('/transactions', 'POST', {
                    account_id: itemAccId,
                    category_id: catId,
                    type: item.type || 'expense',
                    amount: parseFloat(item.amount),
                    date: item.date || fmtDate(),
                    note: item.note || item.name || ''
                });
            });

        const results = await Promise.allSettled(tasks);
        const imported = results.filter(r => r.status === 'fulfilled' && r.value).length;
        showToast(tt('aiRec.importOk', '成功导入 {n}/{m} 条').replace('{n}', String(imported)).replace('{m}', String(this.parsedItems.length)), imported > 0 ? 'success' : 'error');
        document.getElementById('aiResults').style.display = 'none';
        this.parsedItems = [];
        this.billClear();   // 清的是账单上传态，不动 OCR 那一侧
        await initCache();
        await DashboardManager.refresh();
    },

    // ── 分类名 → 分类 ID 的解析基础设施（账单解析用）──────────────
    // 说明：本文件原先把 schema.sql 的种子分类 ID 硬编码在关键词表里。
    // 一旦种子数据调整、用户重命名分类或使用自建分类，硬编码 ID 就会指向错误类目。
    // 现改为「先按名称在运行时 cache.categories 里查真实 ID，查不到才回退到种子 ID」，
    // 关键词表仍以种子 ID 书写（可读性好），由 _seedIdToRealId 统一做一次映射转换。

    // 种子 ID → 种子分类名（与 server/schema.sql 保持一致；仅用于反查名称）
    _SEED_NAMES: {
        1: '餐饮', 2: '交通出行', 3: '购物消费', 4: '居家生活', 5: '休闲娱乐',
        6: '医疗健康', 7: '学习进修', 9: '人情往来', 11: '育儿亲子', 14: '其他支出',
        15: '职业收入', 17: '被动收入', 18: '兼职副业', 21: '其他收入',
        23: '早午晚餐', 24: '外卖小吃', 25: '零食饮料', 26: '烟酒', 27: '聚餐请客',
        28: '生鲜食材', 281: '粮油调味',
        29: '公交地铁', 30: '打车拼车', 31: '加油充电', 32: '停车过路', 33: '火车飞机', 34: '维保车险',
        35: '日用百货', 36: '服饰美容', 37: '数码电器', 38: '家居家具',
        39: '房租月供', 40: '水电燃气', 41: '物业维修', 42: '话费宽带', 43: '社保保险',
        44: '日用杂货', 45: '快递邮寄',
        46: '电影演出', 47: '游戏电竞', 48: '运动健身', 49: '旅游度假', 50: '宠物开销', 51: '会员订阅',
        52: '门诊药品', 53: '体检住院', 54: '牙科眼科', 55: '保健养生',
        56: '培训考试', 57: '书本文具', 58: '知识付费',
        59: '孝敬父母', 60: '送礼红包', 61: '慈善捐赠', 62: '请客招待',
        67: '奶粉尿布', 68: '玩具童书', 69: '学费培训', 70: '医疗保健',
        71: '工资薪水', 72: '奖金绩效', 73: '补贴报销', 74: '理财收益', 75: '房租收入', 76: '分红利息',
        77: '自由职业', 78: '咨询服务', 79: '自媒体创作', 80: '电商微商'
    },

    // 按分类名在运行时缓存里查真实 ID（精确匹配优先，其次包含匹配）
    _findCatIdByName(name) {
        if (!name || typeof cache === 'undefined' || !Array.isArray(cache.categories)) return null;
        const exact = cache.categories.find(c => c.name === name);
        if (exact) return exact.id;
        const partial = cache.categories.find(c => c.name && (c.name.includes(name) || name.includes(c.name)));
        return partial ? partial.id : null;
    },

    // 种子 ID → 当前库中的真实 ID（名称对不上时按种子 ID 兜底）
    _seedIdToRealId(seedId) {
        const name = this._SEED_NAMES[seedId];
        if (!name) return seedId;
        return this._findCatIdByName(name) || seedId;
    },

    // 将 AI 返回的类别名映射到 category_id
    resolveCategoryId(category, itemName) {
        // 结合分类名和商户名做精准二级分类匹配
        const searchText = ((itemName || '') + ' ' + (category || '')).toLowerCase();

        // 1) AI 已给出确切分类名 → 直接按名称查真实 ID（无需经过种子 ID）
        if (category) {
            const direct = this._findCatIdByName(category);
            if (direct) return direct;
        }

        // 2) 二级分类名的种子映射（AI 返回名与库中名不一致时的兼容层）
        const directMap = {
            '早午晚餐': 23, '外卖小吃': 24, '零食饮料': 25, '烟酒': 26, '聚餐请客': 27, '生鲜食材': 28, '粮油调味': 281,
            '公交地铁': 29, '打车拼车': 30, '加油充电': 31, '停车过路': 32, '火车飞机': 33, '维保车险': 34,
            '日用百货': 35, '服饰美容': 36, '数码电器': 37, '家居家具': 38,
            '房租月供': 39, '水电燃气': 40, '物业维修': 41, '话费宽带': 42, '社保保险': 43, '日用杂货': 44, '快递邮寄': 45,
            '电影演出': 46, '游戏电竞': 47, '运动健身': 48, '旅游度假': 49, '宠物开销': 50, '会员订阅': 51,
            '门诊药品': 52, '体检住院': 53, '牙科眼科': 54, '保健养生': 55,
            '培训考试': 56, '书本文具': 57, '知识付费': 58,
            '孝敬父母': 59, '送礼红包': 60, '慈善捐赠': 61, '请客招待': 62,
            '奶粉尿布': 67, '玩具童书': 68, '学费培训': 69, '医疗保健': 70,
            '工资薪水': 71, '奖金绩效': 72, '补贴报销': 73, '理财收益': 74, '房租收入': 75, '分红利息': 76,
            '自由职业': 77, '咨询服务': 78, '自媒体创作': 79, '电商微商': 80
        };
        if (category && directMap[category]) return this._seedIdToRealId(directMap[category]);

        // 精准二级分类映射：关键词 → 二级分类 ID（与 schema.sql 种子 id 严格一致）
        const subCatMap = [
            // 餐饮（一级 1）
            { kw: ['早餐','早','包子','豆浆','油条','粥','肠粉','粢饭','盒饭','盖饭','便当','食堂','饼','面','粉','饭','卷','汤','饺子','馄饨','米线','麻辣烫','冒菜','拌面','炒饭','午餐','午','晚餐','晚','夜宵','宵夜','烧烤','串','火锅','烤鱼','小龙虾','大排档','炸鸡','汉堡'], id: 23 },
            { kw: ['外卖','美团','饿了么','配送','跑腿'], id: 24 },
            { kw: ['零食','水果','糖','巧克力','冰淇淋','薯片','坚果','瓜子','饮料','矿泉水','奶茶','咖啡','可乐','雪碧','果汁','茶饮','牛奶'], id: 25 },
            { kw: ['烟','酒','啤酒','白酒','红酒','香烟'], id: 26 },
            { kw: ['聚餐','聚会','请客','AA','饭局','朋友','同事'], id: 27 },
            { kw: ['生鲜','菜','肉','蛋','鱼','虾','蔬菜','超市买菜','菜市场'], id: 28 },
            { kw: ['粮油','米','面','油','盐','调味','酱油','醋'], id: 281 },
            // 交通出行（一级 2）
            { kw: ['地铁','公交','一卡通','交通卡'], id: 29 },
            { kw: ['打车','滴滴','曹操','T3','首汽','花小猪','出租车'], id: 30 },
            { kw: ['加油','中石化','中石油','汽油','柴油','充电','充电桩','特来电','星星充电'], id: 31 },
            { kw: ['停车','停车场','泊车','车位','过路费','高速','ETC','通行费'], id: 32 },
            { kw: ['火车','高铁','机票','飞机','航旅','12306','携程','去哪','飞猪'], id: 33 },
            { kw: ['保养','维修','4S','修车','换胎','换机油','年检','车险','洗车'], id: 34 },
            // 购物消费（一级 3）
            { kw: ['日用','百货','日用品','纸巾','洗衣','垃圾袋','清洁','拖把','扫把'], id: 35 },
            { kw: ['服装','衣服','鞋','包','裤','衣','袜','帽','围巾','手套','护肤','面膜','精华','美发','理发','烫发','染发'], id: 36 },
            { kw: ['数码','手机','电脑','耳机','平板','数据线','鼠标','键盘','电器'], id: 37 },
            { kw: ['家居','家具','床','桌','椅','柜','沙发','灯','窗帘'], id: 38 },
            // 居家生活（一级 4）
            { kw: ['房租','租金','房东','中介','租房','月供','房贷'], id: 39 },
            { kw: ['水电','电费','水费','燃气','煤气','天然气'], id: 40 },
            { kw: ['物业','物管','管理费','疏通','漏水'], id: 41 },
            { kw: ['话费','手机费','移动','联通','电信','sim卡','宽带','网费','光纤','wifi'], id: 42 },
            { kw: ['社保','医保','养老','公积金','五险','保险','保费','理赔'], id: 43 },
            { kw: ['快递','顺丰','圆通','中通','申通','韵达','邮政','EMS'], id: 45 },
            // 休闲娱乐（一级 5）
            { kw: ['电影','影院','猫眼','淘票票','IMAX','KTV','唱歌','酒吧','夜店','蹦迪','livehouse'], id: 46 },
            { kw: ['游戏','steam','Switch','PS','Xbox','手游','充值','皮肤','道具','电竞'], id: 47 },
            { kw: ['健身','运动','跑步','瑜伽','游泳','球','器械','私教'], id: 48 },
            { kw: ['旅游','景点','门票','度假','酒店','民宿'], id: 49 },
            { kw: ['猫粮','狗粮','猫砂','罐头','冻干','宠物','疫苗','驱虫','绝育','猫抓板','逗猫棒','狗绳','猫窝','狗窝'], id: 50 },
            { kw: ['会员','订阅','VIP','视频会员'], id: 51 },
            // 医疗健康（一级 6）
            { kw: ['门诊','挂号','医院','诊所','医生','看病','检查','化验','药','药品','药房','药店','处方','感冒','咳嗽','消炎','止痛','创可贴'], id: 52 },
            { kw: ['体检','体检中心','住院','手术'], id: 53 },
            { kw: ['牙','拔牙','洗牙','配镜','眼科','视力'], id: 54 },
            { kw: ['保健','养生','按摩','理疗','推拿'], id: 55 },
            // 学习进修（一级 7）
            { kw: ['培训','课程','网课','补习','辅导班','学而思','新东方','考试','报名','雅思','托福','四六级','考研','考公'], id: 56 },
            { kw: ['书','书籍','教材','书店','文具','kindle'], id: 57 },
            { kw: ['知识付费','得到','知乎','喜马拉雅','订阅课'], id: 58 },
            // 人情往来（一级 9）
            { kw: ['父母','爸','妈','爹','娘','老人','长辈'], id: 59 },
            { kw: ['红包','送礼','礼物','份子钱','彩礼'], id: 60 },
            { kw: ['慈善','捐赠','捐款'], id: 61 },
            { kw: ['请客','买单','招待','饭局'], id: 62 },
            // 育儿亲子（一级 11）
            { kw: ['奶粉','尿布','纸尿裤'], id: 67 },
            { kw: ['玩具','童书','绘本'], id: 68 },
            { kw: ['学费','幼儿园','学校','培训费'], id: 69 },
            // 收入二级
            { kw: ['工资','底薪','月薪','工资条','薪水'], id: 71 },
            { kw: ['奖金','年终奖','绩效','提成','分红'], id: 72 },
            { kw: ['补贴','报销','差旅','餐饮补贴','交通补贴','房补'], id: 73 },
            { kw: ['理财收益','利息','基金','股票','债券','余额宝','理财通'], id: 74 },
            { kw: ['房租收入','收租'], id: 75 },
            { kw: ['分红','股息','利息收入'], id: 76 },
            { kw: ['副业','兼职','接单','外包','自由职业'], id: 77 },
            { kw: ['咨询','顾问','私活'], id: 78 },
            { kw: ['自媒体','创作','稿费','直播'], id: 79 },
            { kw: ['电商','微商','开店','网店'], id: 80 },
        ];

        // 3) 关键词精准匹配二级分类（表内写种子 ID，命中后转成真实 ID）
        for (const rule of subCatMap) {
            for (const kw of rule.kw) {
                if (searchText.includes(kw)) return this._seedIdToRealId(rule.id);
            }
        }

        // 4) 一级分类兜底（同样经种子 ID → 真实 ID 转换）
        const catMap = { '餐饮': 1, '交通': 2, '购物': 3, '居家': 4, '住房': 4, '娱乐': 5, '休闲': 5, '医疗': 6, '教育': 7, '学习': 7, '人情': 9, '育儿': 11, '职业收入': 15, '工资': 15, '被动收入': 17, '投资收益': 17, '兼职': 18, '副业': 18, '其他收入': 21 };
        if (category) {
            for (const [key, id] of Object.entries(catMap)) {
                if (category.includes(key)) return this._seedIdToRealId(id);
            }
        }
        // 5) 全部未命中 → 「其他支出」
        return this._seedIdToRealId(14);
    }
};

export default AIRecognition;
