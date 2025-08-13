const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { init: initDB, Counter } = require("./db");

const logger = morgan("tiny");
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// ---------------- 基础示例保持 ----------------

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({ truncate: true });
  }
  res.send({ code: 0, data: await Counter.count() });
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  res.send({ code: 0, data: result });
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  } else {
    res.status(400).send("not from weixin cloud");
  }
});

// ---------------- 全国简化版税费计算（仅核定征收） ----------------
// 住宅：综合 3%（房产税约 2%，个税约 1%）
// 非住宅：综合 5%（房产税约 4%，个税约 1%）
// 说明：查账征收差异较大，本接口不提供据实核算。
app.post("/api/tax/calc-simple", (req, res) => {
  try {
    const { monthlyRent, houseType } = req.body || {};
    const rent = Number(monthlyRent);

    if (!rent || rent <= 0) {
      return res.status(400).json({ code: 1, msg: "月租金必须大于0" });
    }
    if (!houseType || !["residential", "non_residential"].includes(houseType)) {
      return res.status(400).json({ code: 1, msg: "houseType 取值应为 residential 或 non_residential" });
    }

    // 税率设定
    const rates = houseType === "residential"
      ? { total: 0.03, property: 0.02, income: 0.01 }
      : { total: 0.05, property: 0.04, income: 0.01 };

    const propertyTax = +(rent * rates.property).toFixed(2);
    const incomeTax   = +(rent * rates.income).toFixed(2);
    const totalTax    = +(rent * rates.total).toFixed(2);

    return res.json({
      code: 0,
      data: {
        houseType,
        monthlyRent: rent,
        propertyTax,
        incomeTax,
        totalTax,
        rates
      },
      msg: "ok"
    });
  } catch (e) {
    return res.status(500).json({ code: 1, msg: e.message || "server error" });
  }
});

// ---------------- 服务启动 ----------------
const port = process.env.PORT || 80;
async function bootstrap() {
  await initDB();
  app.listen(port, () => console.log("启动成功", port));
}
bootstrap();
