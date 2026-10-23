// 하네스 결과 두 개 비교: node compare.js before.json after.json
// 에러·콘솔 에러·네트워크 요청 순서·전역 함수 목록·화면 표시 상태·최종 DOM(주석 제외, 공백 정규화)이 같아야 "SAME".
const a = require(require("path").resolve(process.argv[2])), b = require(require("path").resolve(process.argv[3]));
const norm = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ");
let bad = 0;
for (let i = 0; i < a.length; i++) {
  for (const k of ["errors", "consoleErrors", "requests", "globalFns", "listViewDisplay", "detailViewDisplay", "missing"]) {
    if (JSON.stringify(a[i][k]) !== JSON.stringify(b[i][k])) { bad++; console.log("DIFF", a[i].name, k); }
  }
  if (norm(a[i].body) !== norm(b[i].body)) { bad++; console.log("DIFF", a[i].name, "body"); }
  console.log(`[${a[i].name}] errors ${a[i].errors.length}→${b[i].errors.length}, requests ${a[i].requests.length}→${b[i].requests.length}, globalFns ${a[i].globalFns.length}→${b[i].globalFns.length}`);
}
console.log(bad ? `DIFFERENT (${bad})` : "SAME");
process.exit(bad ? 1 : 0);
