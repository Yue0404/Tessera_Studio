/** Git checkout 可改变行尾；生成内容比较只归一化 CRLF，不忽略其他字节差异。 */
export function normalizeLineEndings(value) {
  return value.replaceAll("\r\n", "\n");
}
