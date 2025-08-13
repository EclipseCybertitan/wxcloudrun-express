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
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  res.send({
    code: 0,
    data: result,
  });
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});

/**
 * 房租税费计算接口
 * 请求参数：
 * {
 *   "monthlyRent": 5000,
 *   "houseType": "residential", // 或 "non_residential"
 *   "deduction": 500 // 扣除金额，单位元，可选，最大800
 * }
 */
app.post("/api/tax/calculate", (req, res) => {
  try {
    let { monthlyRent, houseType, deduction } = req.body;

    if (!monthlyRent || !houseType) {
      return res.status(400).json({ code: 1, msg: "缺少必要参数" });
    }

    monthlyRent = Number(monthlyRent);
    deduction = Number(deduction) || 0;

    // 限制扣除金额最大800
    if (deduction > 800) deduction = 800;
    if (deduction < 0) deduction = 0;

    // 住房：按 5% 征收率减按 1.5%，非住房：按 5% 全额
    const rentTaxRate = houseType === "residential" ? 0.015 : 0.05;
    const rentTax = monthlyRent * rentTaxRate / (1 + rentTaxRate);

    // 扣除后的计税基数
    const taxableBase = Math.max(monthlyRent - rentTax - deduction, 0);

    // 个人所得税
    const incomeTaxRate = houseType === "residential" ? 0.10 : 0.20;
    const incomeTax = taxableBase * incomeTaxRate;

    const totalTax = rentTax + incomeTax;

    res.json({
      code: 0,
      data: {
        rentTax: parseFloat(rentTax.toFixed(2)),
        taxableBase: parseFloat(taxableBase.toFixed(2)),
        incomeTax: parseFloat(incomeTax.toFixed(2)),
        totalTax: parseFloat(totalTax.toFixed(2)),
        deductionApplied: deduction
      },
      msg: "ok"
    });
  } catch (err) {
    res.status(500).json({ code: 1, msg: err.message });
  }
});

const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
