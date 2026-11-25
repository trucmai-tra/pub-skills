import assert from 'node:assert/strict';
import {createPlan,loadSourceData} from './plan_links.mjs';

// Regression fixtures learned from the reviewer's 2026-09-19 revisions, not held-out accuracy tests.
const sources=loadSourceData();
const cases=[
  ['tài liệu','https://www.canva.com/vi_vn/tai-lieu/','Chuẩn bị tài liệu trước khi gửi.'],
  ['ảnh chân dung','https://www.canva.com/vi_vn/anh/s/chan-dung/','Đặt ảnh chân dung cạnh phần chữ.'],
  ['album gia đình','https://www.canva.com/vi_vn/album-anh/mau/','Chọn bố cục cho album gia đình.'],
  ['Canva Pro','https://www.canva.com/vi_vn/pro/','Tính năng này yêu cầu Canva Pro.'],
  ['email','https://www.canva.com/vi_vn/email/','Gửi nội dung qua email.'],
  ['phông','https://www.canva.com/vi_vn/tinh-nang/phong-chu-mien-phi/','Chọn phông cho phần chữ.'],
];
for(const [anchor,url,sentence] of cases){
  const plan=createPlan({page_url:'https://www.canva.com/vi_vn/tinh-nang/chen-chu-vao-anh/',format:'html',content:`<p>${sentence}</p>`},sources);
  assert(plan.placements.some(p=>p.anchor===anchor&&p.target_url===url),`Expected learned pair: ${anchor} -> ${url}`);
}
const oldTarget='https://www.canva.com/vi_vn/thiet-ke/documents/';
const plan=createPlan({page_url:'https://www.canva.com/vi_vn/tinh-nang/lat-anh/',format:'html',content:'<p>Chuẩn bị tài liệu trước khi gửi.</p>'},sources);
assert(!plan.placements.some(p=>p.anchor==='tài liệu'&&p.target_url===oldTarget));
assert(!plan.contextual_decisions.some(p=>p.anchor==='tài liệu'&&p.target_url===oldTarget));
console.log('Revision preference regression tests passed: six learned pairs and exact corrected-pair block');
