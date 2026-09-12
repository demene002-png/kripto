// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import crypto from 'crypto';

export interface IDatabase {
  exec(sql: string): Promise<void>;
  get(sql: string, params?: any[]): Promise<any>;
  all(sql: string, params?: any[]): Promise<any[]>;
  run(sql: string, params?: any[]): Promise<{ lastID?: number; changes?: number }>;
}

class SqliteDbAdapter implements IDatabase {
  private syncDb: any;
  constructor(filepath: string) {
    this.syncDb = new DatabaseSync(filepath);
  }
  async exec(sql: string): Promise<void> {
    this.syncDb.exec(sql);
  }
  async get(sql: string, params: any[] = []): Promise<any> {
    const stmt = this.syncDb.prepare(sql);
    return stmt.get(...(params || []));
  }
  async all(sql: string, params: any[] = []): Promise<any[]> {
    const stmt = this.syncDb.prepare(sql);
    return stmt.all(...(params || []));
  }
  async run(sql: string, params: any[] = []): Promise<{ lastID?: number; changes?: number }> {
    const stmt = this.syncDb.prepare(sql);
    const res = stmt.run(...(params || []));
    return {
      lastID: Number(res.lastInsertRowid),
      changes: Number(res.changes),
    };
  }
}

let db: IDatabase | null = null;

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  if (!stored?.startsWith('scrypt:')) return password === stored; // one-time legacy migration path
  const [, salt, expectedHex] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function initDb() {
  if (db) return db;
  db = new SqliteDbAdapter(path.join(process.cwd(), 'database.sqlite'));
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      balance REAL
    );
    CREATE TABLE IF NOT EXISTS portfolio_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      symbol TEXT,
      amount REAL,
      averageBuyPrice REAL,
      type TEXT,
      margin REAL,
      leverage REAL,
      stopLoss REAL,
      takeProfit1 REAL,
      takeProfit2 REAL,
      trailingActivation REAL,
      trailingDistancePct REAL,
      highestPrice REAL,
      riskAmount REAL,
      tp1Hit INTEGER DEFAULT 0,
      tp2Hit INTEGER DEFAULT 0,
      managed INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS trade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      symbol TEXT,
      type TEXT,
      price REAL,
      amount REAL,
      margin REAL,
      leverage REAL,
      realized_pnl REAL,
      timestamp INTEGER
    );
    CREATE TABLE IF NOT EXISTS signals_log (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      symbol TEXT,
      type TEXT,
      price REAL,
      aiScore INTEGER,
      analysis TEXT,
      status TEXT,
      source TEXT,
      timestamp INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY,
      autoPilot INTEGER DEFAULT 0,
      autoPilotAmount REAL DEFAULT 100,
      autoPilotBudget REAL DEFAULT 1000,
      dailyTargetPercent REAL DEFAULT 3,
      riskProfile TEXT DEFAULT 'BALANCED',
      riskPerTradePercent REAL DEFAULT 0.5,
      maxDailyLossPercent REAL DEFAULT 2,
      maxOpenRiskPercent REAL DEFAULT 1.75,
      maxPositions INTEGER DEFAULT 3,
      executionMode TEXT DEFAULT 'PAPER',
      automationMode TEXT DEFAULT 'MANUAL',
      safeMode INTEGER DEFAULT 0,
      positionSizePercent REAL DEFAULT 25
    );
    CREATE TABLE IF NOT EXISTS shadow_signals (
      id TEXT PRIMARY KEY, user_id INTEGER, symbol TEXT, created_at INTEGER, entry_price REAL,
      opportunity_with_news REAL, risk_with_news REAL, confidence_with_news REAL, decision_with_news TEXT,
      opportunity_without_news REAL, risk_without_news REAL, confidence_without_news REAL, decision_without_news TEXT,
      news_level TEXT, news_reason TEXT, news_cost_usd REAL DEFAULT 0, ai_cost_usd REAL DEFAULT 0,
      horizon_minutes INTEGER, resolve_at INTEGER, exit_price REAL, return_pct REAL, news_contribution_pct REAL,
      news_contribution_usd REAL, resolved_at INTEGER, status TEXT DEFAULT 'OPEN'
    );
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY, user_id INTEGER, symbol TEXT, interval TEXT, created_at INTEGER,
      metrics_json TEXT, monte_carlo_json TEXT, trades_json TEXT
    );
    CREATE TABLE IF NOT EXISTS execution_audit (
      id TEXT PRIMARY KEY, user_id INTEGER, environment TEXT, automation_mode TEXT, symbol TEXT,
      side TEXT, requested_value REAL, exchange_order_id TEXT, status TEXT, response_json TEXT, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS testnet_positions (
      user_id INTEGER, symbol TEXT, base_asset TEXT, quantity REAL, average_entry REAL,
      stop_loss REAL, take_profit1 REAL, take_profit2 REAL, trailing_activation REAL, trailing_distance_pct REAL,
      highest_price REAL, risk_amount REAL, tp1_hit INTEGER DEFAULT 0, tp2_hit INTEGER DEFAULT 0,
      last_reconciled_at INTEGER, status TEXT DEFAULT 'OPEN',
      PRIMARY KEY(user_id,symbol)
    );
    CREATE TABLE IF NOT EXISTS system_health_log (
      id TEXT PRIMARY KEY, component TEXT, severity TEXT, message TEXT, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS testnet_trade_history (
      id TEXT PRIMARY KEY, user_id INTEGER, symbol TEXT, side TEXT, quantity REAL,
      price REAL, realized_pnl REAL, reason TEXT, exchange_order_id TEXT, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS live_positions (
      user_id INTEGER, symbol TEXT, base_asset TEXT, quantity REAL, average_entry REAL,
      stop_loss REAL, stop_order_id TEXT, risk_amount REAL, opened_at INTEGER,
      last_reconciled_at INTEGER, status TEXT DEFAULT 'OPEN',
      PRIMARY KEY(user_id,symbol)
    );
    CREATE TABLE IF NOT EXISTS live_trade_history (
      id TEXT PRIMARY KEY, user_id INTEGER, symbol TEXT, side TEXT, quantity REAL,
      price REAL, realized_pnl REAL, reason TEXT, exchange_order_id TEXT, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_shadow_user_status ON shadow_signals(user_id,status,resolve_at);
    CREATE INDEX IF NOT EXISTS idx_backtest_user_created ON backtest_runs(user_id,created_at);
  `);


  async function ensureColumn(table:string, name:string, definition:string) {
    const cols = await db!.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c:any) => c.name === name)) await db!.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  await ensureColumn('settings','riskProfile',"TEXT DEFAULT 'BALANCED'");
  await ensureColumn('settings','riskPerTradePercent','REAL DEFAULT 0.5');
  await ensureColumn('settings','maxDailyLossPercent','REAL DEFAULT 2');
  await ensureColumn('settings','maxOpenRiskPercent','REAL DEFAULT 1.75');
  await ensureColumn('settings','maxPositions','INTEGER DEFAULT 3');
  await ensureColumn('settings','executionMode',"TEXT DEFAULT 'PAPER'");
  await ensureColumn('settings','automationMode',"TEXT DEFAULT 'MANUAL'");
  await ensureColumn('settings','safeMode','INTEGER DEFAULT 0');
  await ensureColumn('settings','liveCapitalCapUsd','REAL DEFAULT 0');
  await ensureColumn('settings','liveApiPermissionAttested','INTEGER DEFAULT 0');
  await ensureColumn('settings','emergencyDrillAttested','INTEGER DEFAULT 0');
  await ensureColumn('settings','testnetReviewAttested','INTEGER DEFAULT 0');
  await ensureColumn('settings','newsRetestAttested','INTEGER DEFAULT 0');
  await ensureColumn('settings','positionSizePercent','REAL DEFAULT 25');
  await ensureColumn('portfolio_positions','stopLoss','REAL');
  await ensureColumn('portfolio_positions','takeProfit1','REAL');
  await ensureColumn('portfolio_positions','takeProfit2','REAL');
  await ensureColumn('portfolio_positions','trailingActivation','REAL');
  await ensureColumn('portfolio_positions','trailingDistancePct','REAL');
  await ensureColumn('portfolio_positions','highestPrice','REAL');
  await ensureColumn('portfolio_positions','riskAmount','REAL');
  await ensureColumn('portfolio_positions','tp1Hit','INTEGER DEFAULT 0');
  await ensureColumn('portfolio_positions','tp2Hit','INTEGER DEFAULT 0');
  await ensureColumn('portfolio_positions','managed','INTEGER DEFAULT 1');
  await ensureColumn('shadow_signals','primary_strategy',"TEXT");
  await ensureColumn('shadow_signals','market_regime',"TEXT");
  await ensureColumn('shadow_signals','consensus_count',"INTEGER DEFAULT 0");
  await ensureColumn('shadow_signals','veto_active',"INTEGER DEFAULT 0");

  const user = await db.get('SELECT * FROM users WHERE username = ?', ['admin']);
  if (!user) {
    const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
    const result = await db.run('INSERT INTO users (username, password, balance) VALUES (?, ?, ?)', ['admin', hashPassword(initialPassword), 100]);
    await db.run('INSERT OR IGNORE INTO settings (user_id, autoPilot, autoPilotAmount, autoPilotBudget, dailyTargetPercent, positionSizePercent) VALUES (?, 0, 100, 1000, 3, 25)', [result.lastID]);
    if (!process.env.INITIAL_ADMIN_PASSWORD) console.warn(`[SECURITY] INITIAL_ADMIN_PASSWORD yok. Tek kullanımlık rastgele admin parolası: ${initialPassword}`);
    else console.warn('[SECURITY] Admin user created with INITIAL_ADMIN_PASSWORD.');
  } else if (!String(user.password).startsWith('scrypt:')) {
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashPassword(String(user.password)), user.id]);
    console.warn('[SECURITY] Legacy plaintext password migrated to scrypt hash.');
  }
  return db;
}

export async function getDb() {
  if (!db) return await initDb();
  return db;
}
