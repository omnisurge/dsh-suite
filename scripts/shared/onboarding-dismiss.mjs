/**
 * Dismiss the first-run notices of the official desktop shell.
 *
 * Both native checks open the real GUI, and each had its own hard-coded "Configure later" click. That label
 * belongs to the runtime, not to this repository: 0.2.0 named its notice that way, 0.2.1 opens with a preview
 * notice whose control is "Continue" and then a sign-in step. A pinned label therefore turned a correct
 * candidate into a gate failure. One implementation keeps the two call sites from drifting apart.
 *
 * Only controls inside a presentation modal are clicked, and whatever was clicked is returned so the caller
 * can record it as evidence. Nothing here asserts success: the caller still has to prove the shell is usable.
 */
const CANDIDATES=['Continue','Configure later','Skip','Open app','Close'];

export async function dismissOnboarding(page,{steps=8}={}){
 const used=[];
 for(let step=0;step<steps;step+=1){
  const modal=page.locator('[role="presentation"]').last();
  if(await modal.count()===0){await page.waitForTimeout(300);continue;}
  let clicked=false;
  for(const name of CANDIDATES){
   const button=modal.getByRole('button',{name,exact:true}).first();
   if(await button.count()===0)continue;
   if(!(await button.isVisible().catch(()=>false)))continue;
   const clickedAt=await button.click({timeout:5000}).then(()=>true).catch(()=>false);
   if(!clickedAt)continue;
   used.push(name);clicked=true;await page.waitForTimeout(350);break;
  }
  if(!clicked)break;
 }
 return used;
}

/** What a still-open modal offers, for a gate that has to fail: a bare "mask intercepted the click" hides it. */
export async function describeOpenModal(page){
 return page.evaluate(()=>{
  const presentations=[...document.querySelectorAll('[role="presentation"]')];
  const buttons=[...document.querySelectorAll('button,[role="button"],a')].map(node=>({label:node.getAttribute('aria-label'),text:String(node.innerText??'').trim().slice(0,40),cls:String(node.className??'').slice(0,40)}));
  return {presentations:presentations.map(root=>({cls:String(root.className??'').slice(0,60),text:String(root.innerText??'').slice(0,900)})),buttons:buttons.slice(0,40)};
 }).catch(error=>({error:String(error.message??error)}));
}
