// script.js — unified app script (drop-in replacement)
// - single DOMContentLoaded
// - robust bag (localStorage) handling
// - live mini-cart updates without refresh
// - product controls, mini-cart UI, checkout renderer, slides, reveal, reviews carousel
// - mini-cart: background scroll allowed, click-outside / background click closes, interactive inside doesn't close
// - clicking floating cart / cart button toggles mini-cart (closes if open)
// - prevents checkout navigation if cart empty
(function(){
  'use strict';
  const LOG = true;
  const BAG_KEY = 'bag';
  const UPDATE_KEY = '__bag_updated_at';
  const FLAT_SHIPPING = 2.50;
  const FREE_SHIPPING_OVER = 60.00;

  const log = (...a) => { if (LOG) console.log('[app]', ...a); };

  // DOM helpers
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from((root || document).querySelectorAll(sel));

  // set --vh for mobile stability
  function setVh(){ document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`); }
  setVh();
  window.addEventListener('resize', setVh);

  /* -------------------------
     Storage: load/save bag
  -------------------------*/
  function loadBag(){
    try {
      const raw = localStorage.getItem(BAG_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { localStorage.removeItem(BAG_KEY); return []; }
      return parsed;
    } catch(err){
      console.warn('[app] malformed bag — clearing', err);
      try { localStorage.removeItem(BAG_KEY); } catch(e){}
      return [];
    }
  }

  function formatPrice(n){ return '$' + (Number(n)||0).toFixed(2); }

  function saveBag(bag){
    try { localStorage.setItem(BAG_KEY, JSON.stringify(bag || [])); }
    catch(err){ console.error('[app] saveBag error', err); }
    // notify other tabs and trigger storage listener there
    try { localStorage.setItem(UPDATE_KEY, Date.now().toString()); } catch(e){}
    // update UI in this tab immediately
    renderBadges();
    try { renderMiniCart(); } catch(e){}
    try { renderProductControls(); } catch(e){}   // ensure product cards update immediately
    try { syncSubtotalDisplays(); } catch(e){}
    try { updateCheckoutButtonState(); } catch(e){} // ensure checkout state matches bag
  }

  function syncSubtotalDisplays(){
    const bag = loadBag();
    const subtotal = bag.reduce((s,i) => s + (Number(i.price||0) * Number(i.qty||0)), 0);
    const selectors = ['#mini-cart-sub','#mini-cart-subtotal','#subtotal','#checkout-subtotal','#bag-total'];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { if (el) el.textContent = formatPrice(subtotal); });
    });
  }

  /* -------------------------
     Badges & small UI
  -------------------------*/
  function renderBadges(){
    const bag = loadBag();
    const totalQty = bag.reduce((s,i) => s + Number(i.qty || 0), 0);
    // possible badge selectors
    const els = ['#cart-quantity', '#floating-cart-qty', '#nav-cart-qty'];
    els.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.textContent = totalQty;
    });
  }

  /* -------------------------
     TOAST
  -------------------------*/
  function showToast(msg, d=1800){
    const existing = document.querySelector('.add-toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'add-toast';
    t.textContent = msg;
    Object.assign(t.style, { position:'fixed', left:'50%', transform:'translateX(-50%)', bottom:'22px', background:'rgba(0,0,0,0.88)', color:'#fff', padding:'10px 14px', borderRadius:'8px', zIndex:99999, fontWeight:800 });
    document.body.appendChild(t);
    setTimeout(()=> t.remove(), d);
  }

  /* -------------------------
     Checkout button state management
     - disables/enables mini-cart checkout link
     - intercepts clicks to bag.html when bag empty
  -------------------------*/
  function updateCheckoutButtonState(){
    const bag = loadBag();
    const isEmpty = !bag || bag.length === 0;
    // mini-cart checkout anchor (common structure in your HTML)
    const checkoutAnchor = document.querySelector('#mini-cart .mini-cart-footer a.btn') || document.querySelector('#mini-cart .actions a.btn') || document.querySelector('#mini-cart .actions .btn');
    if (checkoutAnchor){
      if (isEmpty){
        checkoutAnchor.classList.add('disabled');
        checkoutAnchor.setAttribute('aria-disabled','true');
        // mark that we've added prevention (idempotent)
        checkoutAnchor.dataset.__disabled = '1';
      } else {
        checkoutAnchor.classList.remove('disabled');
        checkoutAnchor.removeAttribute('aria-disabled');
        delete checkoutAnchor.dataset.__disabled;
      }
    }

    // also disable any explicit checkout action buttons inside checkout page (defensive)
    $$('.place-order, .checkout-action, button[data-role="checkout"]').forEach(btn => {
      if (isEmpty){
        btn.disabled = true;
        btn.classList.add('disabled');
        btn.setAttribute('aria-disabled','true');
      } else {
        btn.disabled = false;
        btn.classList.remove('disabled');
        btn.removeAttribute('aria-disabled');
      }
    });
  }

  // Intercept clicks to bag.html (mini-cart or other links) and prevent navigation when bag empty
  document.addEventListener('click', (e) => {
    const anchor = e.target.closest('a[href$="cart.html"], a[href$="/cart.html"], a[href$="bag"]');
    if (!anchor) return;
    const bag = loadBag();
    if (!bag || bag.length === 0){
      e.preventDefault();
      showToast('Your cart is empty');
      // Also open the mini-cart to hint user to add items
      const miniCart = document.getElementById('mini-cart') || document.querySelector('.mini-cart');
      if (miniCart && !miniCart.classList.contains('show')) showMiniCart(true);
    }
  }, true); // capture so it triggers before navigation

  /* -------------------------
     Add / Change bag helpers
  -------------------------*/
  function addToCart(id, qty=1){
    if (!id) return;
    const bag = loadBag();
    const idx = bag.findIndex(x => String(x.id) === String(id));
    // try read meta from DOM if possible
    const card = document.querySelector(`.product-card[data-id="${id}"]`);
    const title = card?.dataset?.title || card?.querySelector('.product-title')?.textContent || id;
    const price = Number(card?.dataset?.price) || 0;
    const img = card?.querySelector('img')?.src || '';
    if (idx === -1){
      bag.push({ id, title, price, qty, img });
    } else {
      bag[idx].qty = (Number(bag[idx].qty) || 0) + qty;
    }
    saveBag(bag);
    showToast(`${title} ×${qty} added`);
    // visual feedback
    const flo = document.getElementById('floating-cart');
    if (flo) { flo.classList.add('pulse'); setTimeout(()=> flo.classList.remove('pulse'), 420); }
  }

  function changeQtyById(id, delta){
    if (!id) return;
    const bag = loadBag();
    const idx = bag.findIndex(x => String(x.id) === String(id));
    if (idx === -1){
      // attempt to add if positive
      if (delta > 0){
        const card = document.querySelector(`.product-card[data-id="${id}"]`);
        const title = card?.dataset?.title || id;
        const price = Number(card?.dataset?.price) || 0;
        bag.push({ id, title, price, qty: delta, img: card?.querySelector('img')?.src || '' });
      } else return;
    } else {
      bag[idx].qty = Math.max(0, (Number(bag[idx].qty) || 0) + delta);
      if (bag[idx].qty <= 0) bag.splice(idx,1);
    }
    saveBag(bag);
    renderMiniCart();
    renderProductControls();
  }

  function removeById(id){
    if (!id) return;
    const bag = loadBag().filter(x => String(x.id) !== String(id));
    saveBag(bag);
    renderMiniCart();
    renderProductControls();
  }

  /* -------------------------
     Mini-cart rendering
  -------------------------*/
  function renderMiniCart(){
    const miniCart = document.getElementById('mini-cart');
    const miniList = document.getElementById('mini-cart-list');
    const miniSubtotal = document.getElementById('mini-cart-sub') || document.getElementById('mini-cart-subtotal');
    if (!miniList) return;
    const bag = loadBag();
    miniList.innerHTML = '';

    if (!bag.length){
      miniList.innerHTML = '<div class="mini-cart-empty">Your bag is empty</div>';
      if (miniSubtotal) miniSubtotal.textContent = formatPrice(0);
      // ensure checkout UI disabled
      updateCheckoutButtonState();
      return;
    }

    let subtotal = 0;
    bag.forEach(item => {
      const row = document.createElement('div');
      row.className = 'mini-cart-item';
      row.dataset.id = item.id;

      const thumb = document.createElement('img');
      thumb.alt = item.title || '';
      thumb.src = item.img || '';

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<div class="title">${escapeHtml(item.title)}</div><div class="price">${formatPrice(item.price)}</div>`;

      const controls = document.createElement('div');
      controls.className = 'controls';
      const qtyWrap = document.createElement('div'); qtyWrap.className = 'qty-controls';
      const btnMinus = document.createElement('button'); btnMinus.className = 'qty-btn'; btnMinus.textContent = '−';
      const qtyNum = document.createElement('div'); qtyNum.className = 'qty-num'; qtyNum.textContent = item.qty || 0;
      const btnPlus = document.createElement('button'); btnPlus.className = 'qty-btn'; btnPlus.textContent = '+';
      qtyWrap.append(btnMinus, qtyNum, btnPlus);

      const remove = document.createElement('button'); remove.className = 'mini-remove'; remove.textContent = 'Remove';

      controls.append(qtyWrap, remove);
      row.append(thumb, meta, controls);
      miniList.appendChild(row);

      // attach listeners
      btnMinus.addEventListener('click', (e) => { e.stopPropagation(); changeQtyById(item.id, -1); });
      btnPlus.addEventListener('click', (e) => { e.stopPropagation(); changeQtyById(item.id, +1); });
      remove.addEventListener('click', (e) => { e.stopPropagation(); removeById(item.id); });

      subtotal += (Number(item.price || 0) * Number(item.qty || 0));
    });

    if (miniSubtotal) miniSubtotal.textContent = formatPrice(subtotal);
    // also sync other subtotal displays
    syncSubtotalDisplays();
    // ensure checkout UI enabled if there are items
    updateCheckoutButtonState();
  }

  /* -------------------------
     Product controls (cards)
  -------------------------*/
  function replaceCtaAnchorWithButton(card){
    if (!card) return;
    const cta = card.querySelector('.cta');
    if (!cta) return;
    if (cta.tagName.toLowerCase() === 'button') return;
    const btn = document.createElement('button');
    btn.className = cta.className;
    btn.type = 'button';
    Object.keys(cta.dataset || {}).forEach(k => btn.dataset[k] = cta.dataset[k]);
    if (cta.hasAttribute('href')){
      let href = cta.getAttribute('href') || '';
      href = href.replace(/([?&])add=[^&]*/g, '').replace(/[?&]$/,'') || 'bag.html';
      btn.dataset.href = href;
    }
    btn.innerHTML = cta.innerHTML;
    cta.replaceWith(btn);
  }

  function updateProductControl(card){
    if (!card) return;
    replaceCtaAnchorWithButton(card);

    const id = card.dataset.id;
    const bag = loadBag();
    const item = bag.find(x => String(x.id) === String(id));
    const cta = card.querySelector('.cta');
    if (!cta) return;
    cta.innerHTML = '';
    if (cta._navHandler){
      cta.removeEventListener('click', cta._navHandler);
      delete cta._navHandler;
    }

    if (item && item.qty > 0){
      const minus = document.createElement('button'); minus.className = 'qty-btn'; minus.type = 'button'; minus.textContent = '−';
      const num = document.createElement('span'); num.className = 'qty-number'; num.textContent = item.qty;
      const plus = document.createElement('button'); plus.className = 'qty-btn'; plus.type = 'button'; plus.textContent = '+';
      const wrap = document.createElement('div'); wrap.className = 'qty-controls'; wrap.append(minus, num, plus);
      cta.appendChild(wrap);
      // stopPropagation inside handlers to prevent global .cta handler
      minus.addEventListener('click', (e) => { e.stopPropagation(); changeQty(card, -1); });
      plus.addEventListener('click', (e) => { e.stopPropagation(); changeQty(card, +1); });

      const handler = function(e){
        // ignore clicks on the qty-controls area (they have their own handlers)
        if (e.target.closest('.qty-controls')) return;
        e.stopPropagation();
        const href = cta.dataset.href || 'cart.html';
        setTimeout(()=> { location.href = href; }, 100);
      };
      cta.addEventListener('click', handler);
      cta._navHandler = handler;
    } else {
      // translations object may exist
      const lang = localStorage.getItem('siteLang') || 'en';
      const translations = { en:{add:'Add to Cart', buy:'Add to Cart'}, kh:{add:'បន្ថែមទៅកាបូប', buy:'ទិញ & មើល'} };
      cta.textContent = (id === 'fiber1') ? translations[lang]?.buy || 'Add to Cart' : translations[lang]?.add || 'Add to Cart';
    }
  }

  function renderProductControls(){
    $$('.product-card').forEach(c => { if (!c.classList.contains('placeholder')) updateProductControl(c); });
  }

  function changeQty(card, delta){
    if (!card) return;
    const id = card.dataset.id;
    const bag = loadBag();
    const idx = bag.findIndex(x => String(x.id) === String(id));
    if (idx === -1 && delta > 0){
      bag.push({ id, title: card.dataset.title || card.querySelector('.product-title')?.textContent || id, price: Number(card.dataset.price)||0, qty: delta, img: card.querySelector('img')?.src || '' });
    } else if (idx === -1){
      return;
    } else {
      bag[idx].qty = Math.max(0, (Number(bag[idx].qty) || 0) + delta);
      if (bag[idx].qty <= 0) bag.splice(idx,1);
    }
    saveBag(bag);
    renderProductControls();
  }

  /* -------------------------
     Checkout renderer (if present)
  -------------------------*/
  function renderCheckout(){
    const container = $('#checkout-items');
    const subtotalEl = $('#checkout-subtotal');
    const emptyMsg = $('#checkout-empty');
    if (!container) { log('no #checkout-items - skipping checkout render'); 
      // still ensure checkout button state elsewhere is correct
      updateCheckoutButtonState();
      return; 
    }
    const bag = loadBag();
    container.innerHTML = '';
    if (!bag || bag.length === 0){
      if (emptyMsg) emptyMsg.style.display = '';
      if (subtotalEl) subtotalEl.textContent = formatPrice(0);
      syncSubtotalDisplays();
      // disable place-order controls on checkout page
      updateCheckoutButtonState();
      return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';
    let subtotal = 0;
    bag.forEach(item => {
      const id = item.id || 'unknown';
      const title = item.title || id;
      const price = Number(item.price) || 0;
      const qty = Number(item.qty) || 0;
      const img = item.img || '';
      const row = document.createElement('div');
      row.className = 'checkout-row';
      row.dataset.id = id;
      row.innerHTML = `
        <div class="checkout-thumb">${ img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(title)}" width="72" height="72">` : `<div class="thumb-placeholder"></div>` }</div>
        <div class="checkout-meta">
          <div class="checkout-title">${escapeHtml(title)}</div>
          <div class="checkout-unit">${formatPrice(price)} each</div>
        </div>
        <div class="checkout-qty">
          <button class="qty-decrease" aria-label="Decrease">−</button>
          <span class="qty-number">${qty}</span>
          <button class="qty-increase" aria-label="Increase">+</button>
        </div>
        <div class="checkout-line-price">${formatPrice(price * qty)}</div>
        <div class="checkout-remove"><button class="remove-btn">Remove</button></div>
      `;
      container.appendChild(row);
      subtotal += price * qty;
    });
    if (subtotalEl) subtotalEl.textContent = formatPrice(subtotal);
    syncSubtotalDisplays();

    // attach delegation once
    if (!container._delegation) {
      container._delegation = true;
      container.addEventListener('click', (e) => {
        const dec = e.target.closest('.qty-decrease');
        const inc = e.target.closest('.qty-increase');
        const rem = e.target.closest('.remove-btn');
        if (dec || inc){
          e.preventDefault();
          const row = (dec || inc).closest('.checkout-row');
          if (!row) return;
          const id = row.dataset.id;
          const bag = loadBag();
          const idx = bag.findIndex(x => String(x.id) === String(id));
          if (idx === -1) return;
          const delta = dec ? -1 : +1;
          bag[idx].qty = Math.max(0, (Number(bag[idx].qty) || 0) + delta);
          if (bag[idx].qty <= 0) bag.splice(idx,1);
          saveBag(bag);
          renderCheckout();
        } else if (rem){
          e.preventDefault();
          const row = rem.closest('.checkout-row');
          if (!row) return;
          const id = row.dataset.id;
          const bag = loadBag().filter(i => String(i.id) !== String(id));
          saveBag(bag);
          renderCheckout();
        }
      });
    }
  }

  /* -------------------------
     Mini-cart open/close helpers (improved behaviour)
     - allow background scroll
     - close when clicking outside OR clicking mini-cart background
     - interactive controls inside mini-cart won't close it
     - clicking floating-cart / cart button toggles mini-cart
  -------------------------*/
  let __miniDocClickHandler = null;
  let __miniDocTouchHandler = null;

  function isInteractiveInsideMini(target) {
    return !!target.closest('button, a, input, select, textarea, .qty-controls, .mini-remove, .qty-btn, .cta, .remove-btn');
  }

  function removeDocMiniListeners(){
    if (__miniDocClickHandler) {
      document.removeEventListener('click', __miniDocClickHandler, true);
      __miniDocClickHandler = null;
    }
    if (__miniDocTouchHandler) {
      document.removeEventListener('touchstart', __miniDocTouchHandler, { capture: true });
      __miniDocTouchHandler = null;
    }
  }

  function showMiniCart(open = true){
    const miniCart = document.getElementById('mini-cart') || document.querySelector('.mini-cart');
    const miniOverlay = document.getElementById('mini-cart-overlay') || document.getElementById('mini-overlay');
    const miniList = document.getElementById('mini-cart-list') || document.querySelector('.mini-cart-list');

    if (!miniCart) return;

    if (open) {
      try { renderMiniCart(); } catch(e){}
      miniCart.classList.add('show');
      if (miniOverlay) miniOverlay.classList.add('show');
      miniCart.setAttribute('aria-hidden','false');
      if (miniOverlay) miniOverlay.setAttribute('aria-hidden','false');
      setTimeout(()=> miniList && miniList.focus(), 120);

      // remove existing first just in case
      removeDocMiniListeners();

      __miniDocClickHandler = function (ev) {
        if (ev.defaultPrevented) return;
        const target = ev.target;
        // ignore clicks on cart toggles
        if (target.closest('.floating-cart') || target.closest('.cart-link') || target.closest('#cart-button') || target.closest('#floating-cart')) {
          return;
        }
        const inside = miniCart.contains(target);
        if (!inside) {
          showMiniCart(false);
          return;
        }
        // inside miniCart: close if clicked the miniCart container itself or non-interactive area
        if (target === miniCart || !isInteractiveInsideMini(target)) {
          showMiniCart(false);
        }
      };

      __miniDocTouchHandler = function (ev) {
        const target = ev.target;
        if (target.closest('.floating-cart') || target.closest('.cart-link') || target.closest('#cart-button') || target.closest('#floating-cart')) {
          return;
        }
        const inside = miniCart.contains(target);
        if (!inside) { showMiniCart(false); return; }
        if (target === miniCart || !isInteractiveInsideMini(target)) { showMiniCart(false); }
      };

      document.addEventListener('click', __miniDocClickHandler, true);
      document.addEventListener('touchstart', __miniDocTouchHandler, { passive: true, capture: true });

    } else {
      miniCart.classList.remove('show');
      if (miniOverlay) miniOverlay.classList.remove('show');
      miniCart.setAttribute('aria-hidden','true');
      if (miniOverlay) miniOverlay.setAttribute('aria-hidden','true');
      removeDocMiniListeners();
    }
  }

  /* -------------------------
     UI wiring & delegates
  -------------------------*/
  // handle CTA add buttons globally
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.cta');
    if (!btn) return;
    // SAFETY: ignore clicks that originate inside qty-controls
    if (e.target.closest('.qty-controls') || e.target.classList.contains('qty-btn')) return;
    e.preventDefault();
    const id = btn.dataset.id || btn.getAttribute('data-id') || btn.closest('.product-card')?.dataset?.id;
    if (!id) return;
    addToCart(id, 1);
  });

  // hook floating cart / nav cart
  function initCartButtons(){
    const floatingCart = $('#floating-cart') || document.querySelector('.floating-cart');
    const cartBtn = $('#cart-button') || $('#cart-btn') || document.querySelector('.cart-link');
    const navCartBtn = $('#nav-cart-btn');
    const miniClose = document.getElementById('mini-cart-close');
    const miniOverlay = document.getElementById('mini-cart-overlay') || document.getElementById('mini-overlay');

    function toggleMiniFromToggleClick(e){
      e.preventDefault();
      const miniCart = document.getElementById('mini-cart') || document.querySelector('.mini-cart');
      const isOpen = miniCart && miniCart.classList.contains('show');
      showMiniCart(!isOpen);
    }

    if (floatingCart) floatingCart.addEventListener('click', toggleMiniFromToggleClick);
    if (cartBtn) cartBtn.addEventListener('click', toggleMiniFromToggleClick);
    if (navCartBtn) navCartBtn.addEventListener('click', toggleMiniFromToggleClick);
    if (miniClose) miniClose.addEventListener('click', () => showMiniCart(false));
    if (miniOverlay) miniOverlay.addEventListener('click', () => showMiniCart(false));
  }

  /* -------------------------
     Storage sync (other tabs)
  -------------------------*/
  window.addEventListener('storage', (e) => {
    if (e.key === BAG_KEY || e.key === UPDATE_KEY) {
      try { renderBadges(); } catch(e){}
      try { renderMiniCart(); } catch(e){}
      try { renderProductControls(); } catch(e){}
      try { renderCheckout(); } catch(e){}
      try { syncSubtotalDisplays(); } catch(e){}
      try { updateCheckoutButtonState(); } catch(e){}
    }
  });

  /* -------------------------
     Small utilities
  -------------------------*/
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* -------------------------
     Slides & reveal (kept minimal)
  -------------------------*/
  function initSlides(){
    const slides = $$('.slide');
    const dotsContainer = $('.dots');
    if (!slides.length || !dotsContainer) return;
    let slideIndex = 0, slideTimer = null, SLIDE_INTERVAL = 4500;
    slides.forEach((s,i)=> {
      const b = document.createElement('button'); b.className='dot'; b.setAttribute('aria-label', `Slide ${i+1}`);
      b.addEventListener('click', ()=>{ goTo(i); restart(); });
      dotsContainer.appendChild(b);
    });
    const dots = $$('.dot');
    function showSlide(i){ slides.forEach(s=>s.classList.remove('show')); dots.forEach(d=>d.classList.remove('active')); slides[i].classList.add('show'); dots[i] && dots[i].classList.add('active'); }
    function nextSlide(){ slideIndex = (slideIndex + 1) % slides.length; showSlide(slideIndex); }
    function goTo(i){ slideIndex = ((i % slides.length) + slides.length) % slides.length; showSlide(slideIndex); }
    function start(){ stop(); slideTimer = setInterval(nextSlide, SLIDE_INTERVAL); }
    function stop(){ if (slideTimer) clearInterval(slideTimer); slideTimer = null; }
    function restart(){ stop(); start(); }
    showSlide(slideIndex); start();

    const hero = $('.hero');
    let touchX = 0;
    hero && hero.addEventListener('touchstart', e => touchX = e.changedTouches[0].clientX);
    hero && hero.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40){ if (dx < 0) nextSlide(); else goTo(slideIndex - 1); restart(); }
    });
  }

  function initReveal(){
    const revealEls = $$('.reveal');
    if ('IntersectionObserver' in window){
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => { if (en.isIntersecting){ en.target.classList.add('in-view'); obs.unobserve(en.target); } });
      }, { threshold: 0.12 });
      revealEls.forEach(el => io.observe(el));
    } else {
      revealEls.forEach(el => el.classList.add('in-view'));
    }
  }

  /* -------------------------
     Reviews autoplay (if present) - lightweight
  -------------------------*/
  function initReviewsAuto(){
    const container = document.querySelector('.reviews-viewport');
    const track = document.querySelector('.reviews-track');
    if (!container || !track) return;
    // clone for infinite
    if (track.dataset.duplicated !== 'true'){
      Array.from(track.children).forEach(n => track.appendChild(n.cloneNode(true)));
      track.dataset.duplicated = 'true';
    }
    let originalWidth = 0;
    function measure(){ originalWidth = track.scrollWidth / 2 || 0; }
    measure();
    let pos = 0, last = performance.now();
    const SPEED = 60; let rafId = null; let running = true;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) running = false;
    function step(now){
      const dt = (now - last) / 1000; last = now;
      if (running && originalWidth > 0){
        pos += SPEED * dt;
        if (pos >= originalWidth) pos -= originalWidth;
        track.style.transform = `translateX(${-pos}px)`;
      }
      rafId = requestAnimationFrame(step);
    }
    function start(){ if (!rafId){ last = performance.now(); rafId = requestAnimationFrame(step); } running = true; }
    function stop(){ running = false; }
    start();
    // pause on pointer interaction but allow vertical scroll
    let active = false, sx=0, sy=0, decided=false, horiz=false;
    container.addEventListener('pointerdown', (e)=>{ active=true; sx=e.clientX; sy=e.clientY; decided=false; stop(); }, {passive:true});
    container.addEventListener('pointermove', (e)=>{ if (!active) return; const dx=Math.abs(e.clientX-sx), dy=Math.abs(e.clientY-sy); if(!decided && (dx>6||dy>6)){ decided=true; horiz = dx>dy; } }, {passive:true});
    container.addEventListener('pointerup', ()=>{ active=false; decided=false; horiz=false; if (!reduce) start(); }, {passive:true});
    window.addEventListener('resize', () => setTimeout(()=>{ measure(); pos = ((pos % originalWidth) + originalWidth) % originalWidth; },120));
    window.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (!reduce) start(); });
  }

  /* -------------------------
     Nav toggle
  -------------------------*/
  function initNavToggle(){
    const navToggle = $('.nav-toggle');
    const siteNav = $('#site-nav');
    if (!navToggle || !siteNav) return;
    navToggle.addEventListener('click', () => {
      const open = siteNav.classList.toggle('show');
      navToggle.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      siteNav.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
  }

  /* -------------------------
     Init on DOM ready
  -------------------------*/
  document.addEventListener('DOMContentLoaded', () => {
    log('init start');
    initNavToggle();
    renderBadges();
    renderMiniCart();
    renderProductControls();
    renderCheckout();
    initCartButtons();
    initSlides();
    initReveal();
    initReviewsAuto();
    // ensure checkout state is correct on load
    updateCheckoutButtonState();
    log('init complete');
  });

  // expose for debugging
  window.app = {
    loadBag,
    saveBag,
    renderMiniCart,
    renderBadges,
    renderCheckout,
    addToCart,
    changeQtyById,
    changeQty,
    removeById,
    showMiniCart
  };

  /* - EOF - */
})();
