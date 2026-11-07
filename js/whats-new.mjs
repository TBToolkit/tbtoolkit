import {LATEST_RELEASE,WHATS_NEW_SEEN_KEY,shouldAnnounceRelease} from './release-notes.mjs';

export function initWhatsNew(){
  if(document.getElementById('whatsNewDialog'))return;
  const nav=document.querySelector('[data-nav]');
  if(!nav)return;
  const menuLink=document.createElement('a');menuLink.href='#whats-new';menuLink.textContent="What’s New";menuLink.dataset.whatsNew='';
  nav.appendChild(menuLink);
  const dialog=document.createElement('dialog');dialog.id='whatsNewDialog';dialog.className='whats-new-dialog';
  dialog.setAttribute('aria-labelledby','whatsNewTitle');
  dialog.innerHTML='<button type="button" class="whats-new-close" aria-label="Close What’s New">×</button><div class="eyebrow">What’s New</div><h2 id="whatsNewTitle"></h2><p class="whats-new-version"></p><ul class="whats-new-highlights"></ul><div class="whats-new-actions"><button type="button" class="whats-new-done">Got it</button><a target="_blank" rel="noopener noreferrer">Full release notes ↗</a></div>';
  dialog.querySelector('h2').textContent=LATEST_RELEASE.title;
  const version=dialog.querySelector('.whats-new-version');version.append('Version '+LATEST_RELEASE.version+' · ');
  const date=document.createElement('time');date.dateTime=LATEST_RELEASE.date;date.textContent=new Date(LATEST_RELEASE.date+'T12:00:00Z').toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});version.appendChild(date);
  for(const [title,text] of LATEST_RELEASE.highlights){
    const item=document.createElement('li'),heading=document.createElement('strong'),description=document.createElement('p');
    heading.textContent=title;description.textContent=text;item.append(heading,description);dialog.querySelector('ul').appendChild(item);
  }
  dialog.querySelector('.whats-new-actions a').href=LATEST_RELEASE.notesUrl;
  document.body.appendChild(dialog);
  let returnFocus=null,timer=null;
  const readSeen=()=>{for(const storage of [()=>localStorage,()=>sessionStorage])try{const seen=storage().getItem(WHATS_NEW_SEEN_KEY);if(seen)return seen;}catch{}return null;};
  const remember=()=>{for(const storage of [()=>localStorage,()=>sessionStorage])try{storage().setItem(WHATS_NEW_SEEN_KEY,LATEST_RELEASE.version);}catch{}};
  const open=()=>{
    clearTimeout(timer);if(dialog.open)return;
    returnFocus=document.activeElement;
    nav.classList.remove('is-open');const toggle=document.querySelector('[data-menu-toggle]');if(toggle){toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open menu');}
    dialog.showModal();document.body.classList.add('whats-new-open');remember();dialog.querySelector('.whats-new-done').focus();
  };
  menuLink.addEventListener('click',event=>{event.preventDefault();open();});
  for(const button of dialog.querySelectorAll('button'))button.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{document.body.classList.remove('whats-new-open');if(returnFocus?.isConnected)returnFocus.focus();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  const showWhenReady=()=>{
    if(!shouldAnnounceRelease(LATEST_RELEASE,readSeen()))return;
    const busy=[...document.querySelectorAll('dialog[open], [role="dialog"]')].some(el=>el!==dialog&&el.getClientRects().length&&!el.hidden);
    if(document.visibilityState==='hidden'||busy){timer=setTimeout(showWhenReady,1000);return;}
    open();
  };
  const schedule=()=>{timer=setTimeout(showWhenReady,700);};
  if(window.parent===window){if(document.readyState==='complete')schedule();else window.addEventListener('load',schedule,{once:true});}
  window.addEventListener('pagehide',()=>clearTimeout(timer));
}
