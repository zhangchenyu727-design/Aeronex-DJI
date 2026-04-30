# AERONEX CI/PL Generator

## Hong Kong CI/PL Generator

### 一键启动（前后端一体化）

```bash
cd python_backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8001
```

然后浏览器打开 **http://localhost:8001**

后端同时提供：
- 前端页面（`/`、`/hongkong`、`/saudi`、`/dubai`）
- API接口（`/api/hk/parse` 等）

### 本地开发模式（热更新）

需要两个终端：

**终端1 - 后端：**
```bash
cd python_backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

**终端2 - 前端：**
```bash
npm run dev
```

前端访问 http://localhost:3000（带API代理到8001）

### 高精度解析原理

后端使用 **Python pdfplumber** 按字符坐标精确切分列：

| 传统方式 | 新方式 |
|---------|--------|
| 浏览器OCR（Tesseract.js）把金额`$4,678`当数量`4678` | Python pdfplumber按x坐标精确提取每列 |
| 文本乱序拼接：`T`+`6941565984197` | 字符坐标排序：`6937224123625 \| Battery \| 36 \| 853.00 \| 30708.00` |
| 成功率 < 10% | 成功率 ≈ 100% |
