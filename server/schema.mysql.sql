-- ============================================
-- 鑫钱包 · MySQL / MariaDB 数据库 Schema
-- 注意：本文件由 server/db.js 在 initDatabase() 中调用，数据库创建由 db.js 负责。
-- 说明：枚举统一用 VARCHAR + CHECK 约束；自增列用 INT AUTO_INCREMENT；
--       幂等写入用 INSERT IGNORE；updated_at 通过列级 ON UPDATE CURRENT_TIMESTAMP 自动刷新。
--       （本文件由 schema.sql 机械转换生成，如需手工调整请同步两处。）
-- ============================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(100),
  avatar VARCHAR(10) DEFAULT '👤',
  fail_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL,
  last_fail_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 多账本（账套）表
CREATE TABLE IF NOT EXISTS books (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  icon VARCHAR(10) DEFAULT '📒',
  color VARCHAR(10) DEFAULT '#6366f1',
  is_default BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_books_user ON books (user_id);

-- 账户表
-- code: 结构化编码（5位），A=账户 + 2位类型 + 2位序号
--   如 A0201=储蓄卡-工商银行，A0100=现金类（虚拟分组）
CREATE TABLE IF NOT EXISTS accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(5) DEFAULT NULL,                        -- 结构化编码（如 A0201）
  user_id INT NOT NULL DEFAULT 1,
  name VARCHAR(50) NOT NULL,                          -- 账户名称
  type VARCHAR(30) NOT NULL CHECK (type IN ('cash','bank_card','credit_card','electronic_payment','financial_account','digital','other')),
  icon VARCHAR(10) DEFAULT '💰',                      -- 图标
  balance DECIMAL(15,2) NOT NULL DEFAULT 0,           -- 当前余额
  opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,   -- 期初余额（复式记账）
  credit_limit DECIMAL(15,2) DEFAULT 0,               -- 信用额度(信用卡)
  is_default BOOLEAN DEFAULT FALSE,                   -- 是否默认账户
  sort_order INT DEFAULT 0,
  status VARCHAR(10) DEFAULT 'active' CHECK (status IN ('active','closed')),
  annual_rate DECIMAL(8,4) NOT NULL DEFAULT 0,                 -- 年利率（百分比，如 1.5 表示 1.5%）；仅展示与「预计利息」估算
  interest_cycle VARCHAR(10) DEFAULT 'monthly' CHECK (interest_cycle IN ('daily','monthly','quarterly','yearly')),
  last_interest_date DATE,                                     -- 上次计息日期（记利息时回写）
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_accounts_user ON accounts (user_id);

CREATE UNIQUE INDEX idx_accounts_code ON accounts (code);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_user_book ON accounts (user_id, book_id);

-- 交易类别表
-- code: 结构化编码（5位），E=支出 I=收入 T=转账 + 2位一级 + 2位二级
--   如 E0101=支出-餐饮-早午晚餐，E0100=餐饮一级本身（仅展示），T0100=转账
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(5),                                      -- 结构化编码（如 E0101）；用户自建分类可不填，种子数据用 code 映射
  parent_id INT DEFAULT NULL,                         -- 父分类ID，NULL为一级分类
  user_id INT DEFAULT NULL,                           -- 所属用户ID（NULL=系统预设全局分类）
  name VARCHAR(50) NOT NULL,                          -- 类别名称
  type VARCHAR(10) NOT NULL CHECK (type IN ('expense','income','transfer')),
  icon VARCHAR(10) DEFAULT '📌',                      -- 图标
  color VARCHAR(10) DEFAULT '#6366f1',                -- 颜色
  sort_order INT DEFAULT 0,
  is_system BOOLEAN DEFAULT TRUE,                     -- 是否系统预设
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_categories_parent ON categories (parent_id);

CREATE INDEX idx_categories_user ON categories (user_id);

CREATE UNIQUE INDEX idx_categories_code ON categories (code);

CREATE UNIQUE INDEX categories_parent_name_unique ON categories (parent_id, name);

-- categories.code 允许为 NULL：用户自建分类无需结构化编码，唯一索引允许 NULL。


-- 交易记录表
CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  account_id INT NOT NULL,                            -- 关联账户
  category_id INT NOT NULL,                           -- 关联类别
  budget_id INT DEFAULT NULL,                         -- 关联预算（可选）
  type VARCHAR(15) NOT NULL CHECK (type IN ('expense','income','transfer_in','transfer_out')),
  amount DECIMAL(15,2) NOT NULL,                      -- 金额
  note VARCHAR(200) DEFAULT '',                       -- 备注
  date TIMESTAMP NOT NULL,                            -- 交易时间（精确到秒）
  transfer_id INT DEFAULT NULL,                       -- 关联转账ID
  source_account_id INT DEFAULT NULL,                 -- 复式记账-资金源账户
  destination_account_id INT DEFAULT NULL,            -- 复式记账-资金目标账户
  investment_txn_id INT DEFAULT NULL,                 -- 关联理财交易记录(investment_transactions.id)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_user_date ON transactions (user_id, date);

CREATE INDEX idx_transactions_account ON transactions (account_id);

CREATE INDEX idx_account_date ON transactions (account_id, date);

CREATE INDEX idx_transactions_category ON transactions (category_id);

CREATE INDEX idx_transactions_type ON transactions (type);

CREATE INDEX idx_transactions_budget ON transactions (budget_id);

CREATE INDEX idx_tx_source ON transactions (source_account_id);

CREATE INDEX idx_tx_dest ON transactions (destination_account_id);
-- 兼容已部署库：新增列与索引（幂等；MySQL 8.0.29+ 支持 ADD COLUMN IF NOT EXISTS）
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS investment_txn_id INT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_inv_txn ON transactions (investment_txn_id);

-- 内部转账记录表
CREATE TABLE IF NOT EXISTS transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  from_account_id INT NOT NULL,                       -- 转出账户
  to_account_id INT NOT NULL,                         -- 转入账户
  amount DECIMAL(15,2) NOT NULL,                      -- 转账金额
  note VARCHAR(200) DEFAULT '',                       -- 转账备注
  date TIMESTAMP NOT NULL,                            -- 转账时间
  status VARCHAR(10) DEFAULT 'completed' CHECK (status IN ('completed','pending','cancelled')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_transfers_user ON transfers (user_id);

CREATE INDEX idx_transfers_from ON transfers (from_account_id);

CREATE INDEX idx_transfers_to ON transfers (to_account_id);

-- 预算表
CREATE TABLE IF NOT EXISTS budgets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  name VARCHAR(100) NOT NULL,                         -- 预算名称
  period_type VARCHAR(10) NOT NULL DEFAULT 'month' CHECK (period_type IN ('month','quarter','half','year')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE (user_id, name, start_date, end_date)
);

-- 投资理财分类体系（一级 投资理财 + 二级 投资买入 / 理财保险）
-- 保险类买入归入理财保险，故 investment_types.category 允许 'insurance'。
INSERT INTO categories (code, name, type, icon, color, sort_order, is_system) VALUES
('E1100', '投资理财', 'expense', '💹', '#22c55e', 10, TRUE);

INSERT IGNORE INTO categories (code, name, type, icon, color, parent_id, is_system) VALUES
('E1101', '投资买入', 'expense', '📈', '#22c55e', (SELECT id FROM categories WHERE code = 'E1100'), TRUE);

INSERT IGNORE INTO categories (code, name, type, icon, color, parent_id, is_system) VALUES
('E1102', '理财保险', 'expense', '🛡️', '#22c55e', (SELECT id FROM categories WHERE code = 'E1100'), TRUE);

-- 理财产品类型表（全局共享，无 user_id）
-- code: 结构化编码（5位），V=投资 + 2位大类 + 2位序号
--   V01=存款固收 V02=基金 V03=A股 V04=港股 V05=美股 V06=商品 V07=加密 V08=外汇 V99=其他
-- is_system：系统预置类型标记，为 TRUE 时禁止普通用户 UPDATE/DELETE，
--            防止任意用户篡改全局类型影响其他所有用户。
CREATE TABLE IF NOT EXISTS investment_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(5) DEFAULT NULL,                        -- 结构化编码（如 V0203）
  name VARCHAR(50) NOT NULL,
  icon VARCHAR(10) DEFAULT '📈',
  risk_level VARCHAR(10) DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','very_high')),
  category VARCHAR(10) NOT NULL DEFAULT 'fund' CHECK (category IN ('fund','stock','deposit','other','hk_stock','us_stock','commodity','crypto','forex','insurance')),
  description VARCHAR(200) DEFAULT '',
  sort_order INT DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_investment_types_code ON investment_types (code);

-- 理财持仓表
CREATE TABLE IF NOT EXISTS investments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  account_id INT DEFAULT NULL,                        -- 关联账户
  investment_type_id INT NOT NULL,                    -- 理财产品类型
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) DEFAULT '',                        -- 产品代码
  buy_price DECIMAL(15,4) NOT NULL DEFAULT 0,
  current_price DECIMAL(15,4) NOT NULL DEFAULT 0,
  quantity DECIMAL(15,4) NOT NULL DEFAULT 0,
  total_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  current_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  fee DECIMAL(15,2) NOT NULL DEFAULT 0,
  buy_date DATE NOT NULL,
  expected_rate DECIMAL(8,4) DEFAULT 0,
  actual_rate DECIMAL(8,4) DEFAULT 0,
  nav_date DATE DEFAULT NULL,                         -- 净值日期
  status VARCHAR(10) DEFAULT 'holding' CHECK (status IN ('holding','sold','expired')),
  sold_date DATE DEFAULT NULL,                      -- 清仓日期（用于清仓当天保留、隔天归档）
  note VARCHAR(200) DEFAULT '',
  risk_level VARCHAR(10) DEFAULT NULL CHECK (risk_level IN ('low','medium','high','very_high')),  -- 每持仓独立风险等级（覆盖类型默认）
  create_transaction_id INT DEFAULT NULL,             -- 创建持仓时同步生成的台账交易（买入扣款），用于删除/编辑时回滚
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_investments_user ON investments (user_id);

CREATE INDEX idx_investments_type ON investments (investment_type_id);

CREATE INDEX idx_investments_status ON investments (status);

-- 理财交易记录
CREATE TABLE IF NOT EXISTS investment_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  investment_id INT NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('buy','sell','dividend','interest','fee','reinvest')),
  amount DECIMAL(15,2) NOT NULL,
  price DECIMAL(15,4) DEFAULT 0,
  quantity DECIMAL(15,4) DEFAULT 0,
  date DATE NOT NULL,
  note VARCHAR(200) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_inv_tx_investment ON investment_transactions (investment_id);

-- 理财净值快照
CREATE TABLE IF NOT EXISTS investment_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  investment_id INT NOT NULL,
  total_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  nav_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (investment_id, nav_date)
);

CREATE INDEX idx_snapshots_user_date ON investment_snapshots (user_id, nav_date);

-- ============================================
-- 插入默认数据
-- ============================================

-- 默认账户
-- code 编码规则：A + 2位类型 + 2位序号
--   A01=cash A02=bank_card A03=credit_card A04=electronic_payment A05=financial A06=digital A99=other
INSERT INTO accounts (id, code, user_id, name, type, icon, balance, opening_balance, credit_limit, is_default, sort_order) VALUES
(1, 'A0101', 1, '现金',       'cash',                '💵', 500.00,   500.00,   0.00,     FALSE, 1),
(2, 'A0201', 1, '工商银行',   'bank_card',           '🏦', 25000.00, 25000.00, 0.00,     TRUE,  2),
(3, 'A0202', 1, '招商银行',   'bank_card',           '🏦', 18000.00, 18000.00, 0.00,     FALSE, 3),
(4, 'A0401', 1, '微信支付',   'electronic_payment',  '💚', 3200.00,  3200.00,  0.00,     FALSE, 4),
(5, 'A0402', 1, '支付宝',     'electronic_payment',  '🔵', 5000.00,  5000.00,  0.00,     FALSE, 5),
(6, 'A0301', 1, '信用卡',     'credit_card',         '💳', 0.00,     0.00,     10000.00, FALSE, 6);

-- ============================================
-- 分类体系 v2：该合并合并、该拓展拓展
-- 15 个一级分类（10 支出 + 4 收入 + 1 转账）+ 54 个二级分类
-- 设计原则：
--   1. 按「消费场景」统一维度，不混入「支付对象/资产」
--   2. 高频场景有子类，低频不展开
--   3. 保留中国特色（社保、红包、孝敬父母、育儿亲子）
--   4. 参考 YNAB/钱迹/少数派/知乎 最佳实践
--   5. 缺失场景主动补齐（烟酒、牙科、知识付费、会员订阅、育儿亲子）
-- ============================================

-- ◆ 支出类别（一级 10 个，code 以 00 结尾表示一级本身仅展示）
INSERT INTO categories (id, code, name, type, icon, color, sort_order, is_system) VALUES
(1,  'E0100', '餐饮',     'expense', '🍜', '#22c55e', 1,  TRUE),
(2,  'E0200', '交通出行', 'expense', '🚗', '#22c55e', 2,  TRUE),
(3,  'E0300', '购物消费', 'expense', '🛒', '#22c55e', 3,  TRUE),
(4,  'E0400', '居家生活', 'expense', '🏠', '#22c55e', 4,  TRUE),
(5,  'E0500', '休闲娱乐', 'expense', '🎮', '#22c55e', 5,  TRUE),
(6,  'E0600', '医疗健康', 'expense', '💊', '#22c55e', 6,  TRUE),
(7,  'E0700', '学习进修', 'expense', '📚', '#22c55e', 7,  TRUE),
(9,  'E0800', '人情往来', 'expense', '🎁', '#22c55e', 8,  TRUE),
(14, 'E1000', '其他支出', 'expense', '📌', '#22c55e', 99, TRUE);

-- 育儿亲子（固定 ID=11）
INSERT INTO categories (id, code, name, type, icon, color, sort_order, is_system) VALUES
(11, 'E0900', '育儿亲子', 'expense', '👶', '#22c55e', 9, TRUE);

-- ◆ 支出二级分类（44 个，code E+一级序号+二级序号）
INSERT INTO categories (id, code, parent_id, name, type, icon, color, sort_order, is_system) VALUES
-- 餐饮 E01（6 子类）
(23, 'E0101', 1, '早午晚餐', 'expense', '🌅', '#22c55e', 1, TRUE),
(24, 'E0102', 1, '外卖小吃', 'expense', '🥡', '#22c55e', 2, TRUE),
(25, 'E0103', 1, '零食饮料', 'expense', '🧋', '#22c55e', 3, TRUE),
(26, 'E0104', 1, '烟酒',     'expense', '🍷', '#22c55e', 4, TRUE),
(27, 'E0105', 1, '聚餐请客', 'expense', '🍻', '#22c55e', 5, TRUE),
(28, 'E0106', 1, '生鲜食材', 'expense', '🥬', '#22c55e', 6, TRUE),
(281, 'E0107', 1, '粮油调味', 'expense', '🌾', '#22c55e', 7, TRUE),
-- 交通出行 E02（6 子类）
(29, 'E0201', 2, '公交地铁', 'expense', '🚌', '#22c55e', 1, TRUE),
(30, 'E0202', 2, '打车拼车', 'expense', '🚕', '#22c55e', 2, TRUE),
(31, 'E0203', 2, '加油充电', 'expense', '⛽', '#22c55e', 3, TRUE),
(32, 'E0204', 2, '停车过路', 'expense', '🅿️', '#22c55e', 4, TRUE),
(33, 'E0205', 2, '火车飞机', 'expense', '🚄', '#22c55e', 5, TRUE),
(34, 'E0206', 2, '维保车险', 'expense', '🔧', '#22c55e', 6, TRUE),
-- 购物消费 E03（4 子类）
(35, 'E0301', 3, '日用百货', 'expense', '🧴', '#22c55e', 1, TRUE),
(36, 'E0302', 3, '服饰美容', 'expense', '👗', '#22c55e', 2, TRUE),
(37, 'E0303', 3, '数码电器', 'expense', '📱', '#22c55e', 3, TRUE),
(38, 'E0304', 3, '家居家具', 'expense', '🛋️', '#22c55e', 4, TRUE),
-- 居家生活 E04（7 子类）
(39, 'E0401', 4, '房租月供', 'expense', '🏘️', '#22c55e', 1, TRUE),
(40, 'E0402', 4, '水电燃气', 'expense', '💡', '#22c55e', 2, TRUE),
(41, 'E0403', 4, '物业维修', 'expense', '🛠️', '#22c55e', 3, TRUE),
(42, 'E0404', 4, '话费宽带', 'expense', '📶', '#22c55e', 4, TRUE),
(43, 'E0405', 4, '社保保险', 'expense', '🛡️', '#22c55e', 5, TRUE),
(44, 'E0406', 4, '日用杂货', 'expense', '🧹', '#22c55e', 6, TRUE),
(45, 'E0407', 4, '快递邮寄', 'expense', '📦', '#22c55e', 7, TRUE),
-- 休闲娱乐 E05（6 子类）
(46, 'E0501', 5, '电影演出', 'expense', '🎬', '#22c55e', 1, TRUE),
(47, 'E0502', 5, '游戏电竞', 'expense', '🎮', '#22c55e', 2, TRUE),
(48, 'E0503', 5, '运动健身', 'expense', '🏋️', '#22c55e', 3, TRUE),
(49, 'E0504', 5, '旅游度假', 'expense', '✈️', '#22c55e', 4, TRUE),
(50, 'E0505', 5, '宠物开销', 'expense', '🐾', '#22c55e', 5, TRUE),
(51, 'E0506', 5, '会员订阅', 'expense', '📺', '#22c55e', 6, TRUE),
-- 医疗健康 E06（4 子类）
(52, 'E0601', 6, '门诊药品', 'expense', '💊', '#22c55e', 1, TRUE),
(53, 'E0602', 6, '体检住院', 'expense', '🏥', '#22c55e', 2, TRUE),
(54, 'E0603', 6, '牙科眼科', 'expense', '🦷', '#22c55e', 3, TRUE),
(55, 'E0604', 6, '保健养生', 'expense', '🌿', '#22c55e', 4, TRUE),
-- 学习进修 E07（3 子类）
(56, 'E0701', 7, '培训考试', 'expense', '📝', '#22c55e', 1, TRUE),
(57, 'E0702', 7, '书本文具', 'expense', '📚', '#22c55e', 2, TRUE),
(58, 'E0703', 7, '知识付费', 'expense', '🎧', '#22c55e', 3, TRUE),
-- 人情往来 E08（4 子类）
(59, 'E0801', 9, '孝敬父母', 'expense', '👴', '#22c55e', 1, TRUE),
(60, 'E0802', 9, '送礼红包', 'expense', '🧧', '#22c55e', 2, TRUE),
(61, 'E0803', 9, '慈善捐赠', 'expense', '💝', '#22c55e', 3, TRUE),
(62, 'E0804', 9, '请客招待', 'expense', '🍻', '#22c55e', 4, TRUE);

-- 育儿亲子二级分类（E09，固定 ID 67-70，parent_id=11）
INSERT INTO categories (id, code, parent_id, name, type, icon, color, sort_order, is_system) VALUES
(67, 'E0901', 11, '奶粉尿布', 'expense', '🍼', '#22c55e', 1, TRUE),
(68, 'E0902', 11, '玩具童书', 'expense', '🧸', '#22c55e', 2, TRUE),
(69, 'E0903', 11, '学费培训', 'expense', '🎓', '#22c55e', 3, TRUE),
(70, 'E0904', 11, '医疗保健', 'expense', '🏥', '#22c55e', 4, TRUE);

-- ◆ 收入类别（一级 4 个）
INSERT INTO categories (id, code, name, type, icon, color, sort_order, is_system) VALUES
(15, 'I0100', '职业收入', 'income',   '💼', '#ef4444', 1,  TRUE),
(17, 'I0200', '被动收入', 'income',   '📈', '#ef4444', 2,  TRUE),
(18, 'I0300', '兼职副业', 'income',   '💻', '#ef4444', 3,  TRUE),
(21, 'I0400', '其他收入', 'income',   '📌', '#ef4444', 99, TRUE);

-- ◆ 转账类别（一般转账 / 贷款债务 带二级明细；其他转账 为一级可选叶子，type 统一为 transfer）
--   一般转账（银行转账 / 信用卡还款 / 存款取款）
--   贷款债务（借入 / 借出 / 还款 / 收债）
--   其他转账
INSERT INTO categories (id, code, name, type, icon, color, sort_order, is_system) VALUES
(22, 'T0100', '一般转账', 'transfer', '🏦', '#3b82f6', 1, TRUE);

INSERT IGNORE INTO categories (id, code, parent_id, name, type, icon, color, sort_order, is_system) VALUES
-- 一般转账 T01（3 子类）
(91, 'T0200', NULL, '贷款债务', 'transfer', '💸', '#3b82f6', 2, TRUE),
(92, 'T0300', NULL, '其他转账', 'transfer', '↔️', '#3b82f6', 99, TRUE),
(93, 'T0101', 22,   '银行转账', 'transfer', '🏦', '#3b82f6', 1, TRUE),
(94, 'T0102', 22,   '信用卡还款', 'transfer', '💳', '#3b82f6', 2, TRUE),
(95, 'T0103', 22,   '存款取款', 'transfer', '🏧', '#3b82f6', 3, TRUE),
(96, 'T0201', 91,   '借入',     'transfer', '🏦', '#3b82f6', 1, TRUE),
(97, 'T0202', 91,   '借出',     'transfer', '🤝', '#3b82f6', 2, TRUE),
(98, 'T0203', 91,   '还款',     'transfer', '💸', '#3b82f6', 3, TRUE),
(99, 'T0204', 91,   '收债',     'transfer', '💰', '#3b82f6', 4, TRUE);

-- ◆ 收入二级分类（10 个）
INSERT INTO categories (id, code, parent_id, name, type, icon, color, sort_order, is_system) VALUES
-- 职业收入 I01（3 子类）
(71, 'I0101', 15, '工资薪水',   'income', '💰', '#ef4444', 1, TRUE),
(72, 'I0102', 15, '奖金绩效',   'income', '🏆', '#ef4444', 2, TRUE),
(73, 'I0103', 15, '补贴报销',   'income', '📋', '#ef4444', 3, TRUE),
-- 被动收入 I02（3 子类）
(74, 'I0201', 17, '理财收益',   'income', '📊', '#ef4444', 1, TRUE),
(75, 'I0202', 17, '房租收入',   'income', '🏠', '#ef4444', 2, TRUE),
(76, 'I0203', 17, '分红利息',   'income', '💹', '#ef4444', 3, TRUE),
-- 兼职副业 I03（4 子类）
(77, 'I0301', 18, '自由职业',   'income', '🎨', '#ef4444', 1, TRUE),
(78, 'I0302', 18, '咨询服务',   'income', '🗣️', '#ef4444', 2, TRUE),
(79, 'I0303', 18, '自媒体创作', 'income', '🎬', '#ef4444', 3, TRUE),
(80, 'I0304', 18, '电商微商',   'income', '🛍️', '#ef4444', 4, TRUE);

-- 理财产品类型
-- code 编码规则：V + 2位大类 + 2位序号
--   V01=存款固收 V02=基金 V03=A股 V04=港股 V05=美股 V06=商品 V07=加密 V08=外汇 V99=其他
INSERT INTO investment_types (id, code, name, icon, risk_level, description, sort_order, category, is_system) VALUES
(1,  'V0101', '银行存款',    '🏦', 'low',       '银行定期/活期存款',               1, 'deposit', TRUE),
(2,  'V0201', '货币基金',    '💰', 'low',       '余额宝等货币市场基金',             2, 'fund', TRUE),
(3,  'V0202', '债券基金',    '📊', 'low',       '纯债/混合债基金',                 3, 'fund', TRUE),
(4,  'V0203', '指数基金',    '📈', 'medium',    '沪深300/中证500等宽基指数',        4, 'fund', TRUE),
(5,  'V0204', '混合基金',    '🔄', 'medium',    '股债混合型基金',                  5, 'fund', TRUE),
(6,  'V0205', '股票基金',    '🚀', 'high',      '主动管理型股票基金',               6, 'fund', TRUE),
(7,  'V0301', '个股',        '💹', 'very_high', '直接持有的个股',                   7, 'stock', TRUE),
(8,  'V9901', '理财产品',    '💎', 'medium',    '银行/券商理财产品',                8, 'other', TRUE),
(9,  'V0102', '国债',        '🏛️', 'low',       '国债/地方债',                      9, 'deposit', TRUE),
(10, 'V0601', '黄金/贵金属', '🥇', 'medium',    '实物黄金/纸黄金/黄金ETF',          10, 'commodity', TRUE),
(11, 'V9902', '其他理财',    '📌', 'medium',    '其他投资品种',                     99, 'other', TRUE),
(12, 'V0401', '港股',        '🇭🇰', 'very_high', '香港交易所上市股票',               11, 'hk_stock', TRUE),
(13, 'V0501', '美股',        '🇺🇸', 'very_high', '美国纳斯达克/NYSE上市股票',        12, 'us_stock', TRUE),
(14, 'V0701', '加密货币',    '₿',   'very_high', '比特币/以太坊等数字资产',          13, 'crypto', TRUE),
(15, 'V0801', '外汇',        '💱', 'high',      '美元/欧元/日元等外汇品种',          14, 'forex', TRUE),
(16, 'V0103', '债券',        '📜', 'low',       '企业债/可转债等固定收益品种',       15, 'deposit', TRUE);

-- 注：id=10 黄金/贵金属 已在上方种子数据直接写入 category='commodity'（支持行情刷新）。


-- ============================================
-- 交易标签表
-- ============================================
CREATE TABLE IF NOT EXISTS tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(20) DEFAULT '#3b82f6',
  icon VARCHAR(10) DEFAULT '🏷️',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tags_user ON tags (user_id);

-- 交易-标签关联表
CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX idx_tt_tag ON transaction_tags (tag_id);

-- 储蓄目标表
CREATE TABLE IF NOT EXISTS savings_goals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  target_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  current_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  account_id INT DEFAULT NULL,                       -- 储蓄账户：钱存入的目标账户（强关联）
  source_account_id INT DEFAULT NULL,                -- 来源账户：默认从哪个账户转入（强关联，不能等于 account_id）
  icon VARCHAR(10) DEFAULT '🎯',
  note VARCHAR(200) DEFAULT '',
  status VARCHAR(10) DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_savings_user ON savings_goals (user_id);

-- AI 服务商配置表
CREATE TABLE IF NOT EXISTS ai_providers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  api_type VARCHAR(10) NOT NULL DEFAULT 'openai' CHECK (api_type IN ('openai','anthropic')),
  base_url VARCHAR(255) NOT NULL,
  api_key TEXT DEFAULT NULL,                          -- AES-256-GCM 加密存储
  model VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_user ON ai_providers (user_id);

CREATE INDEX idx_ai_user_active ON ai_providers (user_id, is_active);

-- 默认标签种子
INSERT INTO tags (id, user_id, name, color, icon) VALUES
(1, 1, '餐饮', '#f59e0b', '🍜'),
(2, 1, '必需', '#22c55e', '⭐'),
(3, 1, '可省', '#10b981', '💡'),
(4, 1, '大额', '#8b5cf6', '💎'),
(5, 1, '订阅', '#3b82f6', '🔁');

-- OCR 配置表
CREATE TABLE IF NOT EXISTS ai_ocr_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'tencent',
  secret_id TEXT NOT NULL,                            -- AES-256-GCM 加密存储
  secret_key TEXT NOT NULL,                           -- AES-256-GCM 加密存储
  region VARCHAR(50) DEFAULT 'ap-guangzhou',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE (user_id)
);

-- 债务台账（应付 + 应收双向）
-- direction: payable = 我欠别人（默认，旧数据保持）；receivable = 别人欠我
-- creditor: 对方名称（银行/机构/个人，语义通用：应付时是债权人，应收时是债务人）
CREATE TABLE IF NOT EXISTS debts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  account_id INT DEFAULT NULL,
  create_transaction_id INT DEFAULT NULL,                -- 创建债务时同步生成的台账交易（应收借出时扣减关联账户余额）
  name VARCHAR(100) NOT NULL,
  type VARCHAR(15) NOT NULL DEFAULT 'loan' CHECK (type IN ('credit_card','loan','personal','other')),
  direction VARCHAR(10) NOT NULL DEFAULT 'payable' CHECK (direction IN ('payable','receivable')),
  creditor VARCHAR(100) DEFAULT '',
  principal DECIMAL(15,2) NOT NULL DEFAULT 0,
  remaining DECIMAL(15,2) NOT NULL DEFAULT 0,
  interest_rate DECIMAL(6,3) DEFAULT 0,
  term_months INT DEFAULT 0,
  method VARCHAR(20) DEFAULT 'equal_installment' CHECK (method IN ('equal_installment','equal_principal','interest_only','minimum','lump_sum','manual')),
  monthly_payment DECIMAL(15,2) DEFAULT 0,
  start_date DATE DEFAULT NULL,
  due_date DATE DEFAULT NULL,
  billing_day SMALLINT DEFAULT NULL,
  payment_day SMALLINT DEFAULT NULL,
  min_payment DECIMAL(15,2) DEFAULT 0,
  status VARCHAR(10) DEFAULT 'active' CHECK (status IN ('active','paid_off','overdue')),
  note VARCHAR(200) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_debts_user ON debts (user_id);

CREATE INDEX idx_debts_user_direction ON debts (user_id, direction);

CREATE INDEX idx_debts_user_account ON debts (user_id, account_id);

-- 债务还款流水
CREATE TABLE IF NOT EXISTS debt_repayments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  debt_id INT NOT NULL,
  account_id INT DEFAULT NULL,
  amount DECIMAL(15,2) NOT NULL,
  principal_part DECIMAL(15,2) DEFAULT 0,
  interest_part DECIMAL(15,2) DEFAULT 0,
  paid_at DATE NOT NULL,
  note VARCHAR(200) DEFAULT '',
  transaction_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_repay_user ON debt_repayments (user_id);

CREATE INDEX idx_repay_debt ON debt_repayments (debt_id);

-- 储蓄流水
CREATE TABLE IF NOT EXISTS savings_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  goal_id INT DEFAULT NULL,
  account_id INT DEFAULT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('deposit','withdraw')),
  amount DECIMAL(15,2) NOT NULL,
  date DATE NOT NULL,
  note VARCHAR(200) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sav_tx_user ON savings_transactions (user_id);

CREATE INDEX idx_sav_tx_goal ON savings_transactions (goal_id);

CREATE INDEX idx_sav_tx_date ON savings_transactions (date);

ALTER TABLE accounts AUTO_INCREMENT = 1;

ALTER TABLE categories AUTO_INCREMENT = 1;

ALTER TABLE investment_types AUTO_INCREMENT = 1;

ALTER TABLE tags AUTO_INCREMENT = 1;

-- ============================================
-- 多账本（账套）支持：为历史表追加 book_id 列 + 复合索引（幂等；MySQL 8.0.29+ 支持 ADD COLUMN IF NOT EXISTS）
-- 每位用户的财务数据归属某个 book_id；book_id IS NULL 表示「用户级共享」（如系统辅助分类、遗留未归属数据）。
-- 具体归属与回填由 server/db.js 的 healBooks() 在启动时自愈完成。
-- books 表与 accounts.book_id 已在上方建表/ALTER 处处理，此处不再重复。
-- ============================================
ALTER TABLE categories               ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE transactions             ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE transfers                ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE budgets                 ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE tags                    ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE savings_goals           ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE debts                   ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE debt_repayments         ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE investments              ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE investment_transactions ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE savings_transactions    ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;
ALTER TABLE investment_snapshots    ADD COLUMN IF NOT EXISTS book_id INT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_user_book      ON categories (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_book    ON transactions (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_transfers_user_book       ON transfers (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user_book         ON budgets (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_tags_user_book           ON tags (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_savings_user_book         ON savings_goals (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_debts_user_book           ON debts (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_repay_user_book           ON debt_repayments (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_investments_user_book     ON investments (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_user_book          ON investment_transactions (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_sav_tx_user_book          ON savings_transactions (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_book       ON investment_snapshots (user_id, book_id);

-- ============================================
-- AI 智能记账 v0.2 · 预测闭环（Phase 1）—— PG 版 schema.sql 的 MySQL 镜像
-- 核心原则：AI 输出【永不直接写账本】，必经 prediction 快照 → 用户确认 → 原子 commit。
-- status  = 生命周期（pending/committed/discarded）
-- verdict = 校验裁决（ready/needs_confirmation/invalid）—— 二者语义不同，勿合并。
-- 方言差异（相对 schema.sql）：
--   SERIAL→INT AUTO_INCREMENT；JSONB→JSON；'{}'::jsonb 默认值→去掉（MySQL 8 的 JSON
--   列不支持字面量默认值，由应用层显式写 '{}'）；部分唯一索引→普通 UNIQUE KEY
--   （MySQL 允许多 NULL，效果等价）；触发器→列级 ON UPDATE CURRENT_TIMESTAMP。
-- ============================================
CREATE TABLE IF NOT EXISTS ai_predictions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  book_id INT DEFAULT NULL,
  prediction_version INT NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','committed','discarded')),
  verdict VARCHAR(20) NOT NULL DEFAULT 'needs_confirmation'
    CHECK (verdict IN ('ready','needs_confirmation','invalid')),
  source VARCHAR(16) NOT NULL DEFAULT 'parse'
    CHECK (source IN ('parse','chat','ocr','voice')),
  request JSON NOT NULL,
  candidate_txns JSON NOT NULL,
  validation JSON NOT NULL,
  decision_trace JSON NOT NULL,
  memory_snapshot JSON DEFAULT NULL,
  model_request JSON DEFAULT NULL,
  model_response JSON DEFAULT NULL,
  route VARCHAR(20) NOT NULL DEFAULT 'local'
    CHECK (route IN ('local','cheap_model','strong_model','fallback')),
  final_txns JSON DEFAULT NULL,
  final_diff JSON DEFAULT NULL,
  idempotency_key VARCHAR(64) DEFAULT NULL,
  committed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ai_pred_idem (idempotency_key),
  KEY idx_ai_pred_user (user_id),
  KEY idx_ai_pred_status (status),
  KEY idx_ai_pred_user_created (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS ai_prediction_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prediction_id INT NOT NULL,
  transaction_id INT NOT NULL,
  seq INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_ptxn_pred (prediction_id),
  KEY idx_ai_ptxn_txn (transaction_id)
);

CREATE TABLE IF NOT EXISTS ai_feedback_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  book_id INT DEFAULT NULL,
  account_id INT DEFAULT NULL,
  prediction_id INT DEFAULT NULL,
  rule_id INT DEFAULT NULL,
  event_type VARCHAR(32) NOT NULL
    CHECK (event_type IN ('explicit_confirmation','explicit_correction','discard',
                          'manual_rule_creation','contradiction','rule_disabled',
                          'consistent_reuse','negative_signal')),
  evidence_score INT NOT NULL DEFAULT 0,
  payload JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_fb_user (user_id),
  KEY idx_ai_fb_pred (prediction_id),
  KEY idx_ai_fb_rule (rule_id),
  KEY idx_ai_fb_type (event_type, created_at)
);

-- ============================================
-- AI v0.2 Phase 3/4/5 表（MySQL 方言）
-- 差异同上：SERIAL→INT AUTO_INCREMENT；JSONB→JSON 且去掉字面量默认值；
-- 部分唯一索引→普通 UNIQUE KEY；触发器→ON UPDATE CURRENT_TIMESTAMP。
-- ============================================
CREATE TABLE IF NOT EXISTS ai_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  book_id INT DEFAULT NULL,
  rule_type VARCHAR(32) NOT NULL DEFAULT 'merchant_category'
    CHECK (rule_type IN ('merchant_category','keyword_category','merchant_account','merchant_type')),
  match_key VARCHAR(120) NOT NULL,
  target_category_id INT DEFAULT NULL,
  target_account_id INT DEFAULT NULL,
  target_type VARCHAR(16) DEFAULT NULL,
  origin VARCHAR(16) NOT NULL DEFAULT 'learned'
    CHECK (origin IN ('manual','learned')),
  status VARCHAR(16) NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','verified','trusted','degraded','disabled')),
  evidence_score INT NOT NULL DEFAULT 0,
  sample_count INT NOT NULL DEFAULT 0,
  hit_count INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  incorrect_count INT NOT NULL DEFAULT 0,
  accuracy_rate DECIMAL(5,4) NOT NULL DEFAULT 0,
  decay_score DECIMAL(10,4) NOT NULL DEFAULT 0,
  last_matched_at TIMESTAMP NULL DEFAULT NULL,
  last_confirmed_at TIMESTAMP NULL DEFAULT NULL,
  last_corrected_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ai_rule_key (user_id, book_id, rule_type, match_key),
  KEY idx_ai_rule_user_status (user_id, status),
  KEY idx_ai_rule_lookup (user_id, rule_type, match_key),
  KEY idx_ai_rule_category (target_category_id),
  KEY idx_ai_rule_created (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS ai_rule_evidence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_id INT NOT NULL,
  user_id INT NOT NULL DEFAULT 1,
  feedback_event_id INT DEFAULT NULL,
  prediction_id INT DEFAULT NULL,
  event_type VARCHAR(32) NOT NULL,
  delta INT NOT NULL DEFAULT 0,
  score_after INT NOT NULL DEFAULT 0,
  status_after VARCHAR(16) DEFAULT NULL,
  payload JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_rev_rule (rule_id, created_at),
  KEY idx_ai_rev_user (user_id),
  KEY idx_ai_rev_pred (prediction_id)
);

CREATE TABLE IF NOT EXISTS ai_memory_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  book_id INT DEFAULT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'semantic'
    CHECK (kind IN ('semantic','negative')),
  subject VARCHAR(120) NOT NULL,
  predicate VARCHAR(32) NOT NULL DEFAULT 'category',
  object_value VARCHAR(120) NOT NULL,
  object_category_id INT DEFAULT NULL,
  support_count INT NOT NULL DEFAULT 0,
  refute_count INT NOT NULL DEFAULT 0,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ai_mem_item (user_id, book_id, kind, subject, predicate, object_value),
  KEY idx_ai_mem_lookup (user_id, kind, subject)
);

CREATE TABLE IF NOT EXISTS ai_evaluation_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  label VARCHAR(80) NOT NULL DEFAULT '',
  dataset_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  engine_version VARCHAR(32) NOT NULL DEFAULT '',
  total_cases INT NOT NULL DEFAULT 0,
  passed_cases INT NOT NULL DEFAULT 0,
  metrics JSON DEFAULT NULL,
  baseline_run_id INT DEFAULT NULL,
  regression JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_eval_run_created (created_at)
);

CREATE TABLE IF NOT EXISTS ai_evaluation_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  run_id INT NOT NULL,
  case_id VARCHAR(64) NOT NULL,
  scenario VARCHAR(32) NOT NULL DEFAULT '',
  input_text TEXT NOT NULL,
  expected JSON DEFAULT NULL,
  actual JSON DEFAULT NULL,
  field_results JSON DEFAULT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_eval_case_run (run_id),
  KEY idx_ai_eval_case_pass (run_id, passed)
);

CREATE TABLE IF NOT EXISTS ai_provider_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 1,
  provider_id INT DEFAULT NULL,
  prediction_id INT DEFAULT NULL,
  route VARCHAR(20) NOT NULL DEFAULT 'local'
    CHECK (route IN ('local','cheap_model','strong_model','fallback')),
  model VARCHAR(80) NOT NULL DEFAULT '',
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  cost_micro_cny INT NOT NULL DEFAULT 0,
  outcome VARCHAR(16) NOT NULL DEFAULT 'success'
    CHECK (outcome IN ('success','timeout','error','circuit_open','skipped')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_usage_user (user_id, created_at),
  KEY idx_ai_usage_route (route, created_at),
  KEY idx_ai_usage_pred (prediction_id)
);
