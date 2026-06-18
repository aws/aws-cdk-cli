export function sideBySide(left: string[], sep: string, right: string[]) {
  const width = left.map(x => x.length).reduce((acc, n) => Math.max(acc, n), 0);

  const ret: string[] = [];
  for (let i = 0; i < left.length || i < right.length; i++) {
    const l = i < left.length ? left[i] : ' '.repeat(width);
    const r = i < right.length ? right[i] : '';
    ret.push(`${l}${sep}${r}`);
  }
  return ret;
}

export function wrapText(n: number, text: string): string[] {
  const breakers = [' ', '\n'];

  const ret: string[] = [];
  let lineStart = 0;
  while (lineStart < text.length) {
    let lineEnd = lineStart + n;
    while (lineEnd > lineStart && lineEnd < text.length && !breakers.includes(text[lineEnd])) {
      lineEnd -= 1;
    }
    if (lineEnd === lineStart) {
      // Could not find a space in this line. Seek forward to the first space to get the smallest line overflow
      lineEnd = lineStart + n;
      while (lineEnd < text.length && !breakers.includes(text[lineEnd])) {
        lineEnd += 1;
      }
    }

    ret.push(text.slice(lineStart, lineEnd));
    lineStart = lineEnd + 1;
  }
  return ret;
}
