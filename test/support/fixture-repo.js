'use strict';
// Builds a throwaway git repo from a fixture folder, with pinned author and commit dates, so scans of it
// are the same on every run and every machine.
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

// recipes: the branches and commits each fixture gets after its first commit on main
const RECIPES = {
  'mini-shop': [
    { branch: 'dev', from: 'main' },
    { branch: 'feature/discounts', from: 'dev', message: 'discounts', edit: {
      'src/lib/orders.ts': s => s.replace('return prisma.order.create', 'const order = prisma.order.create; return order') + '\nexport function discount(total: number, code: string) {\n  return code === "TEN" ? total * 0.9 : total;\n}\n' } },
  ],
  'next-full': [
    { branch: 'dev', from: 'main' },
    { branch: 'feature/rename', from: 'dev', message: 'rename total, drop legacyPrice, coupons', edit: {
      'src/lib/pricing.ts': s => s.replace('export function total(', 'export function grandTotal(').replace(/\nexport function legacyPrice[\s\S]*?\n}\n/, '\n'),
      'src/lib/checkout.ts': s => s.replace("import { total } from '@/lib/pricing';", "import { grandTotal } from '@/lib/pricing';").replace('const amount = total(lines);', 'const amount = grandTotal(lines);'),
      'src/__tests__/pricing.test.ts': s => s.replace(/\btotal\b/g, 'grandTotal'),
      'prisma/schema.prisma': s => s.replace('  status     String\n', '  status     String\n  note       String?\n'),
      'src/lib/coupons.ts': () => "import { prisma } from '@/lib/db';\n\nexport async function findCoupon(code: string) {\n  return prisma.coupon.findUnique({ where: { code } });\n}\n" } },
    { branch: 'feature/docs', from: 'dev', message: 'docs page and readme', edit: {
      'src/app/docs/[[...slug]]/page.tsx': s => s.replace('docs</article>', 'documentation</article>'),
      'README.md': () => '# next-full fixture\n' } },
  ],
  'plain-js': [
    { branch: 'dev', from: 'main' },
    { branch: 'feature/count', from: 'dev', message: 'count items, three decimals', edit: {
      'src/lib/store.js': s => s.replace('module.exports.listItems = listItems;', 'exports.countItems = async function countItems() {\n  return prisma.item.count();\n};\n\nmodule.exports.listItems = listItems;'),
      'src/lib/format.cjs': s => s.replace('toFixed(2)', 'toFixed(3)') } },
  ],
  'py-lambda': [
    { branch: 'dev', from: 'main' },
    { branch: 'feature/refunds', from: 'dev', message: 'refunds', edit: {
      'lib/store.py': s => s + '\n\ndef refund(order_id):\n    table.delete_item(Key={"id": order_id})\n',
      'handlers/orders.py': s => s.replace('    return {"statusCode": 201', '    body["status"] = "new"\n    return {"statusCode": 201') } },
  ],
  'lib-mixed': [
    { branch: 'dev', from: 'main' },
    { branch: 'feature/clamp', from: 'dev', message: 'clamp lower bound', edit: {
      'src/core/util.ts': s => s.replace('return Math.max(lo, Math.min(hi, n));', 'if (n < lo) return lo;\n  return Math.min(hi, n);') } },
  ],
};

function makeRepo(name, { into } = {}) {
  const dir = into || fs.mkdtempSync(path.join(os.tmpdir(), `archivision-${name}-`));
  const root = path.join(dir, name);
  fs.cpSync(path.join(FIXTURES, name), root, { recursive: true });
  let n = 0;
  const env = () => { const d = `2026-01-${String(++n).padStart(2, '0')}T10:00:00Z`; return { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }; };
  const git = (args, e) => execFileSync('git', ['-C', root, '-c', 'user.name=archivision test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8', env: e || { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  git(['init', '-q', '-b', 'main']); git(['add', '-A']); git(['commit', '-q', '-m', name], env());
  for (const step of RECIPES[name] || []) {
    git(['checkout', '-q', '-b', step.branch, step.from]);
    if (step.edit) {
      for (const [p, f] of Object.entries(step.edit)) {
        const abs = path.join(root, p), before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        const after = f(before);
        if (after === before) throw new Error(`recipe ${name}/${step.branch}: ${p} did not change`);
        fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, after);
      }
      git(['add', '-A']); git(['commit', '-q', '-m', step.message], env());
    }
  }
  // scans run from the last recipe branch, like a developer on a feature branch
  return { root, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

module.exports = { makeRepo, RECIPES, FIXTURES };
