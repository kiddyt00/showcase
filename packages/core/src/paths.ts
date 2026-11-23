/**
 * monorepo 路径解析
 * - DATA_DIR：数据库目录（showcase.db 所在），默认仓库根 data/
 * - PUBLIC_ASSETS_DIR：共享产物目录（videos / diagrams），默认仓库根 public/
 * - 仓库根定位：从 cwd 逐级向上查找 pnpm-workspace.yaml（monorepo 标志文件）
 * 两个 app cwd 不同（apps/site、apps/agent），不能再用 cwd/data。
 */
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // 到达文件系统根仍未找到
    dir = parent;
  }
  // 兜底：找不到 monorepo 标志时按原 cwd 处理（独立部署 / Docker 场景用 env 显式指定）
  return path.resolve(startDir);
}

const REPO_ROOT = findRepoRoot(process.cwd());

export const REPO_ROOT_DIR = REPO_ROOT;

/** 数据目录：优先 DATA_DIR env（相对路径按仓库根解析），否则仓库根 data/ */
export const DATA_DIR = process.env.DATA_DIR
  ? path.isAbsolute(process.env.DATA_DIR)
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(REPO_ROOT, process.env.DATA_DIR)
  : path.join(REPO_ROOT, "data");

/** 共享 public 产物目录：优先 PUBLIC_ASSETS_DIR env，否则仓库根 public/ */
export const PUBLIC_ASSETS_DIR = process.env.PUBLIC_ASSETS_DIR
  ? path.isAbsolute(process.env.PUBLIC_ASSETS_DIR)
    ? path.resolve(process.env.PUBLIC_ASSETS_DIR)
    : path.resolve(REPO_ROOT, process.env.PUBLIC_ASSETS_DIR)
  : path.join(REPO_ROOT, "public");

/** core 包自身根目录（vendor/seecode 与 remotion entry 所在） */
export const CORE_ROOT = path.join(REPO_ROOT, "packages", "core");
