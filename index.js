const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const logger = morgan("tiny");
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// 首页
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/**
 * 简易税费计算
 * @param {number} monthlyRent 月租金（元）
 * @param {string} houseType 房屋类型（residential / non_residential）
 * @param {boolean} propDeduction 是否房产税扣除800
 * @param {boolean} incDeduction 是否个税扣除800
 */
function calcSimpleTax(monthlyRent, houseType, propDeduction, incDeduction) {
  if (!monthlyRent || monthlyRent <= 0) {
    throw new Error("月租金必须大于 0");
  }

  // 默认税率（可按需求调整）
  let propertyRate = 0.04; // 房产税率
  let incomeRate = 0.10;   // 个税率

  if (houseType === "non_residential") {
    propertyRate = 0.12; // 假设非住宅房产税12%
    incomeRate = 0.20;   // 假设非住宅个税20%
  }

  // 房产税计税基数
  let propertyBase = monthlyRent;
  if (propDeduction) {
    propertyBase = Math.max(0, monthlyRent - 800);
  }
  let propertyTax = propertyBase * propertyRate;
  if (propertyBase <= 0) propertyTax = 0;

  // 个税计税基数
  let incomeBase = monthlyRent;
  if (incDeduction) {
    incomeBase = Math.max(0, monthlyRent - 800);
  }
  let incomeTax = incomeBase * incomeRate;
  if (incomeBase <= 0) incomeTax = 0;

  const totalTax = propertyTax + incomeTax;

  return {
    propertyTax: parseFloat(propertyTax.toFixed(2)),
    incomeTax: parseFloat(incomeTax.toFixed(2)),
    totalTax: parseFloat(totalTax.toFixed(2))
  };
}

// 税费计算 API
app.post("/api/tax/calc-simple", (req, res) => {
  try {
    const { monthlyRent, houseType, propDeduction, incDeduction } = req.body;
    const result = calcSimpleTax(
      Number(monthlyRent),
      houseType,
      !!propDeduction,
      !!incDeduction
    );
    res.json({ code: 0, data: result });
  } catch (err) {
    res.json({ code: 1, msg: err.message });
  }
});

const port = process.env.PORT || 80;
app.listen(port, () => {
  console.log("服务已启动，端口：", port);
});
