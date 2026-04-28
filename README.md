# Saudi CI/PL Generator - Web Version

## 启动方式

### 方式一：一键启动（推荐）
```bash
# 安装依赖（首次只需执行一次）
pip install fastapi uvicorn python-multipart pandas openpyxl PyPDF2

# 启动服务
python python_backend/main.py
```

然后打开浏览器访问 `http://localhost:8002`

### 方式二：前后端分离启动（开发模式）

后端：
```bash
python python_backend/main.py
```

前端（另一个终端）：
```bash
npm run dev
```

## 项目结构
```
├── python_backend/       Python FastAPI 后端
│   ├── main.py           API 入口
│   ├── parsers.py        PI/AR 解析逻辑
│   ├── builder.py        Excel 生成逻辑
│   ├── utils.py          工具函数
│   └── data/             模板和映射表
├── src/                  React 前端源码
│   └── pages/
│       └── GeneratorPage.tsx  主页面
└── dist/                 前端构建输出
```
