// 나뉜 파일에서 "바로 실행되는 문장(등록된 처리기 포함)"이 더 뒤 파일에 선언된 이름을 쓰는지 찾는다.
// 파일을 일반 <script>로 나눠 불러오면, 뒤 파일이 아직 안 불러와졌을 때 앞 파일의 처리기가 돌 수 있다. 그런 곳을 찾는 점검.
// 사용: node forward-refs.js [폴더=../../youtube/storyboard]   ("forward-ref statements: 0"이어야 함. [전이] 줄은 사용자 조작 처리기라 참고용)
const fs = require("fs"), path = require("path"), acorn = require("acorn");
const dir = process.argv[2] || path.join(__dirname, "..", "..", "youtube", "storyboard");
const files = fs.readdirSync(dir).filter((f) => /^\d\d-.*\.js$/.test(f)).sort();
const declIn = {};
const parsed = files.map((f, i) => {
  const ast = acorn.parse(fs.readFileSync(path.join(dir, f), "utf8"), { ecmaVersion: "latest", locations: true });
  for (const st of ast.body) {
    if (st.type === "FunctionDeclaration") declIn[st.id.name] = i;
    if (st.type === "VariableDeclaration") for (const d of st.declarations) collectPattern(d.id, (n) => (declIn[n] = i));
  }
  return { f, i, ast };
});
function collectPattern(p, cb) {
  if (!p) return;
  if (p.type === "Identifier") cb(p.name);
  else if (p.type === "ObjectPattern") p.properties.forEach((q) => collectPattern(q.value || q.argument, cb));
  else if (p.type === "ArrayPattern") p.elements.forEach((q) => collectPattern(q, cb));
  else if (p.type === "AssignmentPattern") collectPattern(p.left, cb);
  else if (p.type === "RestElement") collectPattern(p.argument, cb);
}
function idents(node, out) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "Identifier") out.add(node.name);
  for (const k in node) {
    if (k === "loc" || k === "start" || k === "end") continue;
    if (node.type === "MemberExpression" && k === "property" && !node.computed) continue;
    if (node.type === "Property" && k === "key" && !node.computed) continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => idents(x, out));
    else if (v && typeof v.type === "string") idents(v, out);
  }
}
let n = 0;
for (const { f, i, ast } of parsed) {
  for (const st of ast.body) {
    if (st.type === "FunctionDeclaration") continue;
    const ids = new Set();
    if (st.type === "VariableDeclaration") st.declarations.forEach((d) => idents(d.init, ids)); else idents(st, ids);
    const fwd = [...ids].filter((x) => declIn[x] != null && declIn[x] > i);
    if (fwd.length) { n++; console.log(`${f}:${st.loc.start.line}  -> ${fwd.map((x) => x + "@" + files[declIn[x]]).join(", ")}`); }
  }
}
console.log("forward-ref statements:", n);
// 전이: 바로 실행되는 문장이 부르는 함수 선언의 몸통까지 따라간다 (뒤 파일 이름이 나오면 표시)
const fnIdents = {};
for (const { ast } of parsed) for (const st of ast.body) if (st.type === "FunctionDeclaration") { const s = new Set(); idents(st.body, s); st.params.forEach((p) => idents(p, s)); fnIdents[st.id.name] = s; }
let t = 0;
for (const { f, i, ast } of parsed) {
  for (const st of ast.body) {
    if (st.type === "FunctionDeclaration") continue;
    const ids = new Set();
    if (st.type === "VariableDeclaration") st.declarations.forEach((d) => idents(d.init, ids)); else idents(st, ids);
    const seen = new Set(), q = [...ids], hits = new Set();
    while (q.length) {
      const x = q.pop(); if (seen.has(x)) continue; seen.add(x);
      if (declIn[x] != null && declIn[x] > i) hits.add(x + "@" + files[declIn[x]]);
      if (fnIdents[x] && declIn[x] <= i) fnIdents[x].forEach((y) => q.push(y));
    }
    if (hits.size) { t++; console.log(`[전이] ${f}:${st.loc.start.line}  -> ${[...hits].join(", ")}`); }
  }
}
console.log("transitive forward-ref statements:", t);
