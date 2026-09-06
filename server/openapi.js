/**
 * 鑫钱包 · OpenAPI 3.0 规范 (v2.0 — PostgreSQL 版)
 * 自动生成 swagger.json 供前端 Swagger UI 渲染
 */
const spec = {
  openapi: '3.0.3',
  info: {
    title: '鑫钱包 API',
    version: '2.0.0',
    description: '个人财务助手后端 API · Node.js + Express + PostgreSQL · 复式记账 · 含账户/交易/转账/预算/理财/储蓄/债务/报表/AI 分析',
    contact: { name: 'ZJX93', url: 'https://github.com/ZJX93/XinWallet' },
  },
  servers: [
    { url: '/', description: '当前主机' },
    { url: 'http://localhost:18888', description: '本地开发' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
        description: '登录后返回的 token（有效期 1h），配合 refreshToken（7d）自动续期',
      },
    },
    schemas: {
      Success: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {},
          message: { type: 'string' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: '错误说明' },
          code: { type: 'integer' },
        },
      },
      Transaction: {
        type: 'object',
        required: ['account_id', 'category_id', 'type', 'amount'],
        properties: {
          account_id: { type: 'integer' },
          category_id: { type: 'integer' },
          budget_id: { type: 'integer', nullable: true },
          type: { type: 'string', enum: ['income', 'expense', 'transfer_in', 'transfer_out'] },
          amount: { type: 'number', format: 'float', minimum: 0 },
          note: { type: 'string', maxLength: 200 },
          date: { type: 'string', example: '2026-07-27 12:00:00' },
          tags: { type: 'array', items: { type: 'integer' }, description: '标签 ID 列表' },
        },
      },
      Account: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', example: '工商银行' },
          type: { type: 'string', enum: ['cash', 'bank_card', 'credit_card', 'electronic_payment', 'financial_account', 'digital', 'other'] },
          icon: { type: 'string', example: '🏦' },
          balance: { type: 'number' },
          opening_balance: { type: 'number' },
          credit_limit: { type: 'number' },
        },
      },
      Transfer: {
        type: 'object',
        required: ['from_account_id', 'to_account_id', 'amount'],
        properties: {
          from_account_id: { type: 'integer' },
          to_account_id: { type: 'integer' },
          amount: { type: 'number', minimum: 0 },
          note: { type: 'string' },
          date: { type: 'string' },
        },
      },
      Investment: {
        type: 'object',
        required: ['name', 'investment_type_id'],
        properties: {
          name: { type: 'string' },
          investment_type_id: { type: 'integer' },
          account_id: { type: 'integer', nullable: true },
          code: { type: 'string', description: '基金6位数字/股票sh|sz前缀' },
          buy_price: { type: 'number' },
          current_price: { type: 'number' },
          quantity: { type: 'number' },
          total_cost: { type: 'number' },
          current_value: { type: 'number' },
          fee: { type: 'number' },
          buy_date: { type: 'string', format: 'date' },
          expected_rate: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: '认证', description: '注册/登录/演示登录/刷新 Token' },
    { name: '账户', description: '现金/储蓄卡/信用卡/电子支付/理财账户' },
    { name: '交易', description: '收入/支出/转账记录（复式记账）' },
    { name: '转账', description: '账户间资金划转' },
    { name: '预算', description: '分类预算设定与执行跟踪' },
    { name: '理财', description: '投资组合（基金/股票/存款/黄金）' },
    { name: '储蓄', description: '储蓄目标与存取管理' },
    { name: '债务', description: '信用卡/贷款/个人借贷台账' },
    { name: '分类', description: '收支分类（多级树结构）' },
    { name: '标签', description: '交易标签管理' },
    { name: '统计', description: '仪表盘/报表/投资趋势' },
    { name: 'AI', description: '智能建议/消费洞察' },
    { name: '数据', description: 'CSV 导入导出' },
    { name: '系统', description: '健康检查/OpenAPI 文档' },
  ],
  paths: {
    // ============ 系统 ============
    '/healthz': {
      get: { tags: ['系统'], summary: '存活检查', security: [],
        responses: { 200: { description: 'OK' } } },
    },
    '/readyz': {
      get: { tags: ['系统'], summary: '就绪检查（ping PostgreSQL）', security: [],
        responses: { 200: { description: 'Ready' }, 503: { description: 'DB not ready' } } },
    },
    '/health/deep': {
      get: { tags: ['系统'], summary: '深度健康检查（DB/内存/运行时长/配置）', security: [],
        responses: { 200: { description: 'All OK' }, 503: { description: '有检查项失败' } } },
    },
    '/openapi.json': {
      get: { tags: ['系统'], summary: 'OpenAPI 规范 JSON', security: [],
        responses: { 200: { description: 'OpenAPI 3.0.3 规范' } } },
    },
    '/docs': {
      get: { tags: ['系统'], summary: 'Swagger UI 文档页', security: [],
        responses: { 200: { description: 'HTML' } } },
    },

    // ============ 认证 ============
    '/api/auth/register': {
      post: {
        tags: ['认证'], summary: '注册', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 32, pattern: '^[a-zA-Z0-9_-]+$' },
            password: { type: 'string', minLength: 6, maxLength: 128 },
            nickname: { type: 'string' },
          },
        }}}},
        responses: { 200: { description: '返回 token + refreshToken' }, 400: { description: '参数错误' } },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['认证'], summary: '登录', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['username', 'password'],
          properties: { username: { type: 'string' }, password: { type: 'string' } },
        }}}},
        responses: { 200: { description: '返回 token + refreshToken' }, 401: { description: '用户名或密码错误' }, 423: { description: '账号已锁定（多次失败登录后锁定）' } },
      },
    },
    '/api/auth/demo': {
      post: {
        tags: ['认证'], summary: '演示登录（需 ALLOW_DEMO=true）', security: [],
        responses: { 200: { description: '返回 token' }, 403: { description: '演示登录已禁用' } },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['认证'], summary: '刷新 Token（用 refreshToken 换新 token）', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['refreshToken'],
          properties: { refreshToken: { type: 'string' } },
        }}}},
        responses: { 200: { description: '返回新 token' }, 401: { description: 'refreshToken 无效或过期' } },
      },
    },

    // ============ 账户 ============
    '/api/accounts': {
      get: { tags: ['账户'], summary: '账户列表（含总资产）', responses: { 200: { description: 'accounts[] + totalAssets' } } },
      post: {
        tags: ['账户'], summary: '创建账户',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } } },
        responses: { 200: { description: '返回 { id }' } },
      },
    },
    '/api/accounts/{id}': {
      put: {
        tags: ['账户'], summary: '编辑账户（修改 balance 会重置期初基线）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } } },
        responses: { 200: { description: '更新成功' } },
      },
      delete: {
        tags: ['账户'], summary: '关闭账户（软删除 → status=closed）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '关闭成功' } },
      },
    },
    '/api/accounts/reconcile': {
      post: {
        tags: ['账户'], summary: '一键对账（以账本重算所有账户余额）',
        responses: { 200: { description: '{ reconciled, totalAdjusted }' } },
      },
    },

    // ============ 交易 ============
    '/api/transactions': {
      get: {
        tags: ['交易'], summary: '交易列表（多维筛选：月份/类型/分类/账户/标签/金额/搜索/分页）',
        parameters: [
          { name: 'month', in: 'query', schema: { type: 'string', example: '2026-07' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['income', 'expense', 'transfer', 'all'] } },
          { name: 'category_id', in: 'query', schema: { type: 'integer' } },
          { name: 'account_id', in: 'query', schema: { type: 'integer' } },
          { name: 'tag_id', in: 'query', schema: { type: 'integer' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'amount_op', in: 'query', schema: { type: 'string', enum: ['gt', 'lt', 'eq', 'ne', 'bt', 'nb'] } },
          { name: 'amount_val', in: 'query', schema: { type: 'number' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: '交易数组（含 category/account/source/destination/counterparty/tags）' } },
      },
      post: {
        tags: ['交易'], summary: '新增交易',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Transaction' } } } },
        responses: { 200: { description: '返回 { id }' }, 422: { description: '金额/类型校验失败' } },
      },
    },
    '/api/transactions/{id}': {
      put: {
        tags: ['交易'], summary: '更新交易',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Transaction' } } } },
        responses: { 200: { description: '更新成功' } },
      },
      delete: {
        tags: ['交易'], summary: '删除交易（转账会级联删除配对记录）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' } },
      },
    },
    '/api/transactions/months': {
      get: { tags: ['交易'], summary: '有交易的月份列表', responses: { 200: { description: '["2026-07","2026-06",...]' } } },
    },
    '/api/transactions/summary': {
      get: {
        tags: ['交易'], summary: '月度汇总（收入/支出/分类占比）',
        parameters: [{ name: 'month', in: 'query', required: true, schema: { type: 'string', example: '2026-07' } }],
        responses: { 200: { description: '{ income, expense, expenseByCategory[], incomeByCategory[] }' } },
      },
    },
    '/api/transactions/ledger': {
      get: {
        tags: ['交易'], summary: '复式记账流水（来源 → 目标）',
        parameters: [{ name: 'month', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: '流水数组' } },
      },
    },

    // ============ 转账 ============
    '/api/transfers': {
      get: {
        tags: ['转账'], summary: '转账记录列表',
        parameters: [{ name: 'month', in: 'query', schema: { type: 'string', example: '2026-07' } }],
        responses: { 200: { description: '转账数组' } },
      },
      post: {
        tags: ['转账'], summary: '执行转账（事务保证两端余额一致）',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Transfer' } } } },
        responses: { 200: { description: '返回 { id }' }, 409: { description: '余额不足' } },
      },
    },
    '/api/transfers/{id}': {
      put: {
        tags: ['转账'], summary: '修改转账',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Transfer' } } } },
        responses: { 200: { description: '更新成功' } },
      },
      delete: {
        tags: ['转账'], summary: '删除转账',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' } },
      },
    },

    // ============ 预算 ============
    '/api/budgets': {
      get: {
        tags: ['预算'], summary: '预算列表',
        parameters: [{ name: 'period', in: 'query', schema: { type: 'string', example: '2026-07' } }],
        responses: { 200: { description: '预算数组（含 actual 实际支出）' } },
      },
      post: {
        tags: ['预算'], summary: '创建预算',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['name', 'amount'],
          properties: {
            name: { type: 'string' }, amount: { type: 'number' },
            period_type: { type: 'string', enum: ['month', 'quarter', 'half', 'year'] },
            base_date: { type: 'string', format: 'date' },
          },
        }}}},
        responses: { 200: { description: '创建成功' } },
      },
    },
    '/api/budgets/{id}': {
      put: { tags: ['预算'], summary: '更新预算', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '更新成功' } } },
      delete: { tags: ['预算'], summary: '删除预算', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' } } },
    },

    // ============ 分类 ============
    '/api/categories': {
      get: {
        tags: ['分类'], summary: '分类列表（树形 + 扁平）',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['income', 'expense'] } },
          { name: 'flat', in: 'query', schema: { type: 'string' }, description: '1=扁平列表' },
        ],
        responses: { 200: { description: '{ tree, flat }' } },
      },
      post: {
        tags: ['分类'], summary: '创建分类',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['name', 'type'],
          properties: {
            name: { type: 'string' }, type: { type: 'string', enum: ['income', 'expense'] },
            parent_id: { type: 'integer', nullable: true }, icon: { type: 'string' }, color: { type: 'string' },
          },
        }}}},
        responses: { 200: { description: '返回 { id }' } },
      },
    },
    '/api/categories/{id}': {
      put: { tags: ['分类'], summary: '更新分类', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '更新成功' } } },
      delete: { tags: ['分类'], summary: '删除分类', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' }, 400: { description: '有子分类或交易记录' } } },
    },

    // ============ 标签 ============
    '/api/tags': {
      get: { tags: ['标签'], summary: '标签列表', responses: { 200: { description: '标签数组' } } },
      post: {
        tags: ['标签'], summary: '创建标签',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['name'],
          properties: { name: { type: 'string' }, color: { type: 'string' }, icon: { type: 'string' } },
        }}}},
        responses: { 200: { description: '返回 { id }' } },
      },
    },
    '/api/tags/{id}': {
      delete: { tags: ['标签'], summary: '删除标签', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' } } },
    },

    // ============ 储蓄 ============
    '/api/savings-goals': {
      get: { tags: ['储蓄'], summary: '储蓄目标列表', responses: { 200: { description: '目标数组' } } },
      post: {
        tags: ['储蓄'], summary: '创建目标',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['name', 'target_amount'],
          properties: { name: { type: 'string' }, target_amount: { type: 'number' }, account_id: { type: 'integer' }, icon: { type: 'string' }, note: { type: 'string' } },
        }}}},
        responses: { 200: { description: '返回 { id }' } },
      },
    },
    '/api/savings-goals/{id}': {
      put: { tags: ['储蓄'], summary: '更新目标', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '更新成功' } } },
      delete: { tags: ['储蓄'], summary: '删除目标', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' } } },
    },
    '/api/savings-goals/{id}/allocate': {
      post: {
        tags: ['储蓄'], summary: '存入目标',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['amount'], properties: { amount: { type: 'number', minimum: 0 } } } } } },
        responses: { 200: { description: '存入成功' }, 409: { description: '关联账户余额不足' } },
      },
    },
    '/api/savings-goals/{id}/withdraw': {
      post: {
        tags: ['储蓄'], summary: '取回目标',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['amount'], properties: { amount: { type: 'number', minimum: 0 } } } } } },
        responses: { 200: { description: '取回成功' }, 400: { description: '目标余额不足' } },
      },
    },

    // ============ 债务 ============
    '/api/debts': {
      get: { tags: ['债务'], summary: '债务列表', responses: { 200: { description: '债务数组（含还款流水）' } } },
      post: {
        tags: ['债务'], summary: '添加债务',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['name', 'type', 'principal'],
          properties: {
            name: { type: 'string' }, type: { type: 'string', enum: ['credit_card', 'loan', 'personal', 'other'] },
            creditor: { type: 'string' }, principal: { type: 'number' }, remaining: { type: 'number' },
            interest_rate: { type: 'number' }, term_months: { type: 'integer' },
            method: { type: 'string', enum: ['equal_installment', 'equal_principal', 'interest_only', 'minimum', 'lump_sum', 'manual'] },
            monthly_payment: { type: 'number' }, start_date: { type: 'string', format: 'date' },
            due_date: { type: 'string', format: 'date' },
            billing_day: { type: 'integer' }, payment_day: { type: 'integer' },
            min_payment: { type: 'number' }, note: { type: 'string' },
          },
        }}}},
        responses: { 200: { description: '返回 { id }' } },
      },
    },
    '/api/debts/{id}': {
      put: { tags: ['债务'], summary: '更新债务', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '更新成功' } } },
      delete: { tags: ['债务'], summary: '删除债务', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' } } },
    },
    '/api/debts/{id}/repay': {
      post: {
        tags: ['债务'], summary: '记录还款',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['amount', 'paid_at'],
          properties: {
            amount: { type: 'number' }, paid_at: { type: 'string', format: 'date' },
            account_id: { type: 'integer' }, principal_part: { type: 'number' }, interest_part: { type: 'number' }, note: { type: 'string' },
          },
        }}}},
        responses: { 200: { description: '还款记录成功' } },
      },
    },

    // ============ 理财 ============
    '/api/investment-types': {
      get: { tags: ['理财'], summary: '理财类型列表', responses: { 200: { description: '按 sort_order 排序' } } },
      post: {
        tags: ['理财'], summary: '新增理财类型',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['name'],
          properties: {
            name: { type: 'string' }, icon: { type: 'string' },
            risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
            category: { type: 'string', enum: ['fund', 'stock', 'deposit', 'other'] }, description: { type: 'string' },
          },
        }}}},
        responses: { 200: { description: '返回 { id }' } },
      },
    },
    '/api/investment-types/{id}': {
      put: { tags: ['理财'], summary: '更新类型', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '更新成功' } } },
      delete: { tags: ['理财'], summary: '删除类型（无持仓时才可删）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' }, 400: { description: '仍有持仓' } } },
    },
    '/api/investments/holdings': {
      get: { tags: ['理财'], summary: '持仓列表（推荐路径；等价于 /investments/investments）', responses: { 200: { description: '{ investments[], summary, byType }' } } },
      post: {
        tags: ['理财'], summary: '新增持仓（推荐路径）',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Investment' } } } },
        responses: { 200: { description: '返回 { id }' } },
      },
    },
    '/api/investments/investments': {
      get: { tags: ['理财'], summary: '持仓列表（旧路径，兼容保留；推荐 /investments/holdings）', responses: { 200: { description: '{ investments[], summary, byType }' } } },
      post: {
        tags: ['理财'], summary: '新增持仓（旧路径，兼容保留）',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Investment' } } } },
        responses: { 200: { description: '返回 { id }' } },
      },
    },
    '/api/investments/investments/{id}': {
      put: { tags: ['理财'], summary: '更新持仓（编辑 / 仅刷新行情）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '更新成功' } } },
      delete: { tags: ['理财'], summary: '删除持仓', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '删除成功' } } },
    },
    '/api/investments/quote': {
      get: {
        tags: ['理财'], summary: '查询行情（基金→东方财富 / 股票→腾讯证券）',
        parameters: [
          { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'category', in: 'query', schema: { type: 'string', enum: ['fund', 'stock'] } },
        ],
        responses: { 200: { description: '基金：{ nav, navDate } / 股票：{ price, changePercent }' }, 502: { description: '行情查询失败' } },
      },
    },
    '/api/investments/{id}/refresh': {
      post: { tags: ['理财'], summary: '刷新单个持仓行情', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: '{ current_price, current_value, actual_rate }' } } },
    },
    '/api/investments/refresh-all': {
      post: { tags: ['理财'], summary: '一键刷新全部持仓行情', responses: { 200: { description: '{ updated, results[] }' } } },
    },
    '/api/investments/{id}/reduce': {
      post: {
        tags: ['理财'], summary: '加仓/减仓',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['action', 'price', 'quantity'],
          properties: {
            action: { type: 'string', enum: ['buy', 'sell'] }, price: { type: 'number' },
            quantity: { type: 'number' }, fee: { type: 'number' }, date: { type: 'string', format: 'date' }, note: { type: 'string' },
          },
        }}}},
        responses: { 200: { description: '加仓/减仓/清仓成功' } },
      },
    },

    // ============ 统计 ============
    '/api/stats/dashboard': {
      get: {
        tags: ['统计'], summary: '仪表盘数据（今日/本周/本月/本年/账户/理财/债务/预算/储蓄/趋势）',
        responses: { 200: { description: '完整仪表盘数据包' } },
      },
    },
    '/api/stats/dashboard/detail': {
      get: {
        tags: ['统计'], summary: '仪表盘卡片点击明细',
        parameters: [{ name: 'type', in: 'query', required: true, schema: { type: 'string', enum: ['today', 'week', 'month', 'year', 'assets'] } }],
        responses: { 200: { description: '该类型的交易明细或资产分布' } },
      },
    },
    '/api/stats/investments': {
      get: { tags: ['统计'], summary: '理财净值趋势（折线图+柱状图数据）', responses: { 200: { description: '{ trendSeries, byType, summary }' } } },
    },
    '/api/reports': {
      get: {
        tags: ['统计'], summary: '综合报表（月/季/年）',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['monthly', 'quarterly', 'annual'] } },
          { name: 'period', in: 'query', required: true, schema: { type: 'string', example: '2026-07' } },
        ],
        responses: { 200: { description: '完整报表（含摘要/日趋势/分类占比/账户流水/Top支出/预算执行/环比）' } },
      },
    },

    // ============ AI ============
    '/api/ai/advice': {
      post: { tags: ['AI'], summary: 'AI 理财建议（基于本月/上月数据 + 预算/储蓄/债务）', responses: { 200: { description: '{ advice[] }' } } },
    },

    // ============ 账本备份（xlsx 3 工作表） ============
    '/api/backup/export': {
      get: {
        tags: ['数据'], summary: '导出账本 xlsx 备份（账本配置页 / 账户页 / 账单流水页）',
        responses: { 200: { description: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 文件下载' } },
      },
    },
    '/api/backup/import': {
      post: {
        tags: ['数据'], summary: '导入账本 xlsx 备份',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
        responses: { 200: { description: '{ success, data: { imported } }' } },
      },
    },

    // ============ 汇率（多币种 P2-2b）============
    '/api/fx/rates': {
      get: {
        tags: ['汇率'], summary: '取最新汇率（内存/DB/远端 三级 fallback）',
        responses: {
          200: { description: '{ base, date, rates, source, fetchedAt, ageHours, stale }' },
          500: { description: '无可用汇率（DB 为空且远程拉取失败）' },
        },
      },
    },
    '/api/fx/refresh': {
      post: {
        tags: ['汇率'], summary: '强制刷新汇率（拉远端并落库；设置页「刷新汇率」按钮调用）',
        responses: {
          200: { description: '{ base, date, rates, source, fetchedAt, ageHours, stale, warning? }' },
          500: { description: '远程拉取失败（DB 也无则返回错误）' },
        },
      },
    },
  },
};

module.exports = spec;
