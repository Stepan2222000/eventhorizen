from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

from py_backend.context import init_app_context
from py_backend.routes import register_routes
from py_backend.storage import DatabaseStorage

load_dotenv()


def log(message: str, source: str = "express") -> None:
    now = datetime.now().strftime("%I:%M:%S %p").lstrip("0")
    print(f"{now} [{source}] {message}")


class ApiLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        started = time.time()
        path = request.url.path
        response = await call_next(request)

        if not path.startswith("/api"):
            return response

        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        headers = dict(response.headers)
        content_type = headers.get("content-type", "")
        captured_json: Any | None = None
        if content_type.startswith("application/json"):
            try:
                captured_json = json.loads(body.decode("utf-8"))
            except Exception:
                captured_json = None

        duration_ms = int((time.time() - started) * 1000)
        log_line = f"{request.method} {path} {response.status_code} in {duration_ms}ms"
        if captured_json is not None:
            log_line += f" :: {json.dumps(captured_json, ensure_ascii=False)}"
        if len(log_line) > 80:
            log_line = log_line[:79] + "…"
        log(log_line)

        return Response(
            content=body,
            status_code=response.status_code,
            headers=headers,
            media_type=response.media_type,
            background=response.background,
        )


app = FastAPI()
app.add_middleware(ApiLoggingMiddleware)


@app.on_event("startup")
async def startup() -> None:
    ctx = await init_app_context(storage_factory=lambda inventory_pool, smart_cache: DatabaseStorage(inventory_pool, smart_cache))
    app.state.ctx = ctx
    register_routes(app)

    env = os.getenv("NODE_ENV", "development")
    if env == "development":
        client_template = Path(__file__).resolve().parents[1] / "client" / "index.html"

        @app.get("/{full_path:path}")
        async def serve_dev(full_path: str) -> Response:
            if full_path.startswith("api"):
                return JSONResponse(status_code=404, content={"message": "Not Found"})
            if not client_template.exists():
                return JSONResponse(status_code=500, content={"message": f"Could not find the client template: {client_template}"})
            template = client_template.read_text(encoding="utf-8")
            template = template.replace('src="/src/main.tsx"', f'src="/src/main.tsx?v={uuid.uuid4().hex}"')
            return HTMLResponse(content=template)

    else:
        dist_path = Path(__file__).resolve().parents[1] / "dist" / "public"
        if not dist_path.exists():
            raise RuntimeError(
                f"Could not find the build directory: {dist_path}, make sure to build the client first"
            )

        @app.get("/{full_path:path}")
        async def serve_prod(full_path: str) -> Response:
            if full_path.startswith("api"):
                return JSONResponse(status_code=404, content={"message": "Not Found"})
            target = dist_path / full_path
            if full_path and target.exists() and target.is_file():
                return FileResponse(target)
            return FileResponse(dist_path / "index.html")


@app.exception_handler(Exception)
async def handle_exception(_request: Request, err: Exception) -> JSONResponse:
    status = int(getattr(err, "status", getattr(err, "statusCode", 500)) or 500)
    message = str(err) if str(err) else "Internal Server Error"
    print(err)
    return JSONResponse(status_code=status, content={"message": message})


if __name__ == "__main__":
    import uvicorn

    env = os.getenv("NODE_ENV", "development")
    default_port = 5004 if env == "development" else 5000
    port = int(os.getenv("PORT", str(default_port)))
    uvicorn.run("py_backend.main:app", host="0.0.0.0", port=port, reload=False)
