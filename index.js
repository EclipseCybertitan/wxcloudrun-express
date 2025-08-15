// index.js (Node.js + Express + MySQL + 微信云托管)

const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
const mysql = require("mysql2/promise");

// ===== MySQL 连接池（从环境变量获取；已给出默认）=====
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASS || "",
  database: process.env.MYSQL_DB || "taxcalc",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ===== 初始化：仅确保表存在（不创建库，避免权限问题）=====
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calc_records (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      client_id VARCHAR(64) NULL,
      openid VARCHAR(64) NULL,
      house_type VARCHAR(32) NOT NULL,
      monthly_rent DECIMAL(10,2) NOT NULL,
      prop_deduction TINYINT(1) NOT NULL DEFAULT 0,
      inc_deduction  TINYINT(1) NOT NULL DEFAULT 0,
      property_base DECIMAL(10,2) NOT NULL,
      income_base   DECIMAL(10,2) NOT NULL,
      property_rate DECIMAL(6,4)  NOT NULL,
      income_rate   DECIMAL(6,4)  NOT NULL,
      property_tax  DECIMAL(10,2) NOT NULL,
      income_tax    DECIMAL(10,2) NOT NULL,
      total_tax     DECIMAL(10,2) NOT NULL,
      ua VARCHAR(255) NULL,
      ip VARCHAR(64) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_client (client_id),
      KEY idx_openid (openid),
      KEY idx_type   (house_type),
      KEY idx_rent   (monthly_rent),
      KEY idx_time   (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

// ===== Express 应用 =====
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(morgan("tiny"));
app.use(cookieParser());

// ===== 客户标识（cookie）=====
const CLIENT_COOKIE = "tc_client_id";
app.use((req, res, next) => {
  if (!req.cookies[CLIENT_COOKIE]) {
    const id = uuidv4();
    res.cookie(CLIENT_COOKIE, id, {
      httpOnly: true,
      sameSite: "Lax",
      secure: false, // 若强制 HTTPS 可置 true
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    req.clientId = id;
  } else {
    req.clientId = req.cookies[CLIENT_COOKIE];
  }
  next();
});

// ===== 首页（静态 H5）=====
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ===== 健康检查 =====
app.get("/api/ping", (_req, res) => res.json({ ok: true }));

// ===== 云托管控制台调试常用：返回总记录数 =====
app.get("/api/count", async (_req, res) => {
  try {
    const [[row]] = await pool.query("SELECT COUNT(*) AS c FROM calc_records");
    return res.json({ code: 0, data: Number(row.c || 0) });
  } catch {
    // 即使数据库未配置，也给 200，避免 404/5xx 影响联调
    return res.json({ code: 0, data: 0 });
  }
});

/**
 * 计算税费（按月）：
 * - 住宅：房产税 4%（可勾选减半到 2%），个税 10%
 * - 非住宅：房产税 12%，个税 20%
 * - “800元扣除”可分别对房产税、个税基数生效（基数 = max(月租-800, 0)）
 */
function calcSimpleTax(monthlyRent, houseType, propDeduction, incDeduction, propHalf) {
  if (!monthlyRent || monthlyRent <= 0) throw new Error("月租金必须大于 0");

  let propertyRate = houseType === "non_residential" ? 0.12 : (propHalf ? 0.02 : 0.04);
  let incomeRate   = houseType === "non_residential" ? 0.20 : 0.10;

  let propertyBase = monthlyRent;
  if (propDeduction) propertyBase = Math.max(0, monthlyRent - 800);

  let incomeBase = monthlyRent;
  if (incDeduction) incomeBase = Math.max(0, monthlyRent - 800);

  const propertyTax = +(propertyBase * propertyRate).toFixed(2);
  const incomeTax   = +(incomeBase   * incomeRate).toFixed(2);
  const totalTax    = +(propertyTax + incomeTax).toFixed(2);

  return {
    houseType,
    monthlyRent: +(+monthlyRent).toFixed(2),
    propDeduction: !!propDeduction,
    incDeduction:  !!incDeduction,
    propHalf:      !!propHalf,
    propertyBase:  +propertyBase.toFixed(2),
    incomeBase:    +incomeBase.toFixed(2),
    propertyRate,
    incomeRate,
    propertyTax,
    incomeTax,
    totalTax,
    unit: "元/月",
  };
}

// ===== 计算并入库 =====
app.post("/api/tax/calc-simple", async (req, res) => {
  try {
    const { monthlyRent, houseType, propDeduction, incDeduction, propHalf } = req.body || {};
    const rent = Number(monthlyRent);
    if (!["residential", "non_residential"].includes(houseType)) {
      return res.status(400).json({ code: 1, msg: "houseType 无效" });
    }
    const result = calcSimpleTax(rent, houseType, !!propDeduction, !!incDeduction, !!propHalf);

    const openid   = (req.headers["x-wx-openid"] || "").toString().slice(0, 64) || null;
    const clientId = req.clientId || null;
    const ua       = (req.headers["user-agent"] || "").substring(0, 255);
    const ipHdr    = (req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.ip || "").toString();
    const ip       = ipHdr.split(",")[0].trim().substring(0, 64);

    await pool.execute(
      `INSERT INTO calc_records
       (client_id, openid, house_type, monthly_rent, prop_deduction, inc_deduction,
        property_base, income_base, property_rate, income_rate,
        property_tax, income_tax, total_tax, ua, ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        clientId,
        openid,
        result.houseType,
        result.monthlyRent,
        result.propDeduction ? 1 : 0,
        result.incDeduction  ? 1 : 0,
        result.propertyBase,
        result.incomeBase,
        result.propertyRate,
        result.incomeRate,
        result.propertyTax,
        result.incomeTax,
        result.totalTax,
        ua,
        ip,
      ]
    );

    return res.json({ code: 0, data: result });
  } catch (err) {
    return res.status(500).json({ code: 1, msg: err.message || "server error" });
  }
});

// ===== 我的记录（按 openid 或 client_id）=====
app.get("/api/my/records", async (req, res) => {
  try {
    const openid   = (req.headers["x-wx-openid"] || "").toString().slice(0, 64) || null;
    const clientId = req.clientId || null;
    const limit    = Math.min(Number(req.query.limit || 20), 100);

    let sql, params;
    if (openid) {
      sql = `SELECT id, created_at, house_type, monthly_rent,
                    prop_deduction, inc_deduction, property_tax, income_tax, total_tax
               FROM calc_records
              WHERE openid = ?
           ORDER BY id DESC LIMIT ?`;
      params = [openid, limit];
    } else {
      sql = `SELECT id, created_at, house_type, monthly_rent,
                    prop_deduction, inc_deduction, property_tax, income_tax, total_tax
               FROM calc_records
              WHERE client_id = ?
           ORDER BY id DESC LIMIT ?`;
      params = [clientId, limit];
    }

    const [rows] = await pool.execute(sql, params);
    return res.json({ code: 0, data: rows });
  } catch (e) {
    return res.status(500).json({ code: 1, msg: e.message || "server error" });
  }
});

// ===== 概览统计 =====
app.get("/api/stats/overview", async (_req, res) => {
  try {
    const [[agg]] = await pool.query(
      `SELECT
         COUNT(*) AS total_records,
         ROUND(AVG(monthly_rent),2) AS avg_rent,
         ROUND(AVG(total_tax),2)    AS avg_total_tax,
         ROUND(SUM(total_tax),2)    AS sum_total_tax
       FROM calc_records`
    );
    const [byType] = await pool.query(
      `SELECT house_type, COUNT(*) AS cnt,
              ROUND(AVG(total_tax),2) AS avg_tax
         FROM calc_records
        GROUP BY house_type`
    );
    return res.json({ code: 0, data: { agg, byType } });
  } catch (e) {
    return res.status(500).json({ code: 1, msg: e.message || "server error" });
  }
});

// ===== 租金桶分布 =====
app.get("/api/stats/buckets", async (_req, res) => {
  try {
    const edges = [0, 1000, 2000, 3000, 5000, 8000, 10000];
    const labels = [];
    const counts = [];

    for (let i = 0; i < edges.length; i++) {
      const a = edges[i];
      const b = edges[i + 1];
      let sql, params, label;
      if (b == null) {
        label = `${a}+`;
        sql = `SELECT COUNT(*) AS c FROM calc_records WHERE monthly_rent >= ?`;
        params = [a];
      } else {
        label = `${a}-${b}`;
        sql = `SELECT COUNT(*) AS c FROM calc_records WHERE monthly_rent >= ? AND monthly_rent < ?`;
        params = [a, b];
      }
      const [[row]] = await pool.execute(sql, params);
      labels.push(label);
      counts.push(Number(row.c || 0));
    }
    return res.json({ code: 0, data: { labels, counts } });
  } catch (e) {
    return res.status(500).json({ code: 1, msg: e.message || "server error" });
  }
});

const port = process.env.PORT || 80;
async function bootstrap() {
  await ensureSchema();
  app.listen(port, () => console.log("启动成功", port));
}
bootstrap();
