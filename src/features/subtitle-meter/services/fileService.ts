export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("文件编码无法读取，请尝试 UTF-8"));
    reader.onerror = () => reject(new Error("文件读取失败，请重试"));
    reader.readAsText(file, "UTF-8");
  });
}
