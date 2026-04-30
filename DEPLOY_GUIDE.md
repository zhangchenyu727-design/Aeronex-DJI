# 一键部署到云端（Render.com 免费）

## 步骤

### 1. 注册 Render.com
打开 https://render.com ，用GitHub账号登录（免费）

### 2. 创建 Blueprint
1. 点击 "New +" → "Blueprint"
2. 连接你的GitHub仓库（包含本项目代码）
3. Render会自动读取 `render.yaml` 并部署

### 3. 或者手动部署（不需要GitHub）
1. 点击 "New +" → "Web Service"
2. 选择 "Deploy an existing image from a registry" 或直接上传代码
3. Runtime 选 `Docker`
4. 选择免费计划（Free）
5. 点击 Create Web Service

### 4. 部署完成后
Render会给你的服务一个公网URL，比如：
```
https://aeronex-cipl-generator.onrender.com
```

打开这个链接，上传PDF，解析完全在服务端完成，100%准确。

### 5. 分享给别人
直接把这个URL发给同事/朋友，他们打开就能用，不需要安装任何东西。

---

## 为什么必须这样做？

| 方案 | 需要用户做什么 | 解析准确度 | 可分享 |
|------|--------------|-----------|--------|
| 当前线上链接 | 只用浏览器 | 差（数字错乱） | 可以，但不好用 |
| 本地启动后端 | 先运行命令再打开网页 | 100% | 不行，每人都要装 |
| **Render云端部署** | **点几下部署好，以后只用打开链接** | **100%** | **可以，链接发给谁都能用** |

---

## 技术说明

本项目包含：
- `python_backend/main.py` - FastAPI后端（PI/CI/PL解析 + Excel生成）
- `python_backend/hk_parsers.py` - 香港PDF解析器（pdfplumber高精度）
- `dist/` - 构建好的前端网页
- `Dockerfile` - 一键打包前后端
- `render.yaml` - Render平台配置

部署后，一个进程同时提供：
- 前端网页 (`/`)
- API接口 (`/api/hk/parse` 等)
