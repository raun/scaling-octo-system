"use client";

interface FileExplorerProps {
  files: string[];
  activeFile: string | null;
  onFileSelect: (path: string) => void;
}

function getFileIcon(path: string): string {
  if (path.endsWith(".py")) return "🐍";
  if (path.endsWith(".js") || path.endsWith(".ts")) return "JS";
  if (path.endsWith(".json")) return "{}";
  return "📄";
}

export function FileExplorer({
  files,
  activeFile,
  onFileSelect,
}: FileExplorerProps) {
  // Build a simple tree structure
  const tree = buildTree(files);

  return (
    <div className="h-full overflow-auto bg-[#252526] text-[#cccccc] text-base">
      <div className="px-4 py-3 text-sm font-semibold uppercase tracking-wider text-[#888]">
        Explorer
      </div>
      <div className="px-1">
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            activeFile={activeFile}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>
    </div>
  );
}

interface TreeNodeData {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNodeData[];
}

function buildTree(files: string[]): TreeNodeData[] {
  const root: TreeNodeData[] = [];

  for (const filePath of files) {
    const parts = filePath.split("/");
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const existingNode = currentLevel.find((n) => n.name === part);

      if (existingNode) {
        currentLevel = existingNode.children;
      } else {
        const newNode: TreeNodeData = {
          name: part,
          path: isLast ? filePath : parts.slice(0, i + 1).join("/"),
          isDirectory: !isLast,
          children: [],
        };
        currentLevel.push(newNode);
        currentLevel = newNode.children;
      }
    }
  }

  return root;
}

function TreeNode({
  node,
  activeFile,
  onFileSelect,
  depth = 0,
}: {
  node: TreeNodeData;
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  depth?: number;
}) {
  const isActive = node.path === activeFile;

  if (node.isDirectory) {
    return (
      <div>
        <div
          className="flex items-center gap-2 px-3 py-1 text-[#cccccc]"
          style={{ paddingLeft: `${depth * 14 + 12}px` }}
        >
          <span className="text-sm">📁</span>
          <span>{node.name}</span>
        </div>
        {node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            activeFile={activeFile}
            onFileSelect={onFileSelect}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onFileSelect(node.path)}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#2a2d2e] ${
        isActive ? "bg-[#37373d] text-white" : "text-[#cccccc]"
      }`}
      style={{ paddingLeft: `${depth * 14 + 12}px` }}
    >
      <span className="text-sm">{getFileIcon(node.name)}</span>
      <span>{node.name}</span>
    </button>
  );
}
