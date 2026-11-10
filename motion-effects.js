(() => {
  const motion = window.Motion;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!motion || reduceMotion) return;

  const { animate, inView, stagger } = motion;
  const easeOut = [0.22, 1, 0.36, 1];
  const revealed = new WeakSet();
  const claimStates = new Map();

  function shown(element) {
    return element && !element.hidden && !element.closest('[hidden]');
  }

  function enter(targets, options = {}) {
    const elements = [...targets].filter(shown);
    if (!elements.length) return;
    animate(elements, {
      opacity: [0, 1],
      y: [options.distance ?? 14, 0]
    }, {
      duration: options.duration ?? 0.55,
      delay: stagger(options.step ?? 0.07, { startDelay: options.delay ?? 0 }),
      ease: easeOut
    });
  }

  enter(document.querySelectorAll('.site-header .brand, .site-header nav a'), {
    distance: 8,
    duration: 0.45,
    step: 0.055
  });

  enter(document.querySelectorAll('.hero-copy > *, .journal-intro > *, .login-copy > *'), {
    distance: 18,
    duration: 0.65,
    step: 0.085,
    delay: 0.06
  });

  document.querySelectorAll('.hero-art, .login-card').forEach((element, index) => {
    animate(element, {
      opacity: [0, 1],
      y: [20, 0],
      scale: [0.98, 1]
    }, { duration: 0.72, delay: 0.12 + index * 0.08, ease: easeOut });
  });

  const revealTargets = document.querySelectorAll([
    '.values-strip',
    '.section-heading',
    '.checklist-toolbar',
    '.progress-row',
    '.gear-card',
    '.tips-grid article',
    '.closing',
    '.campsite-card',
    '.journal-end'
  ].join(','));

  revealTargets.forEach((element, index) => {
    inView(element, () => {
      if (revealed.has(element)) return;
      revealed.add(element);
      animate(element, {
        opacity: [0, 1],
        y: [16, 0]
      }, {
        duration: 0.58,
        delay: Math.min(index % 3, 2) * 0.045,
        ease: easeOut
      });
    }, { amount: 0.14, margin: '0px 0px -6% 0px' });
  });

  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      window.requestAnimationFrame(() => enter(
        document.querySelectorAll('.gear-card:not([hidden])'),
        { distance: 9, duration: 0.38, step: 0.045 }
      ));
    });
  });

  document.querySelectorAll('[data-item]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      animate(checkbox, { scale: [0.78, 1.14, 1] }, { duration: 0.32, ease: easeOut });
    });
  });

  function animatePlannerView(view) {
    window.requestAnimationFrame(() => {
      if (view === 'login') {
        enter(document.querySelectorAll('.planner-login .login-copy > *, .planner-login .login-card'), {
          distance: 12,
          duration: 0.5,
          step: 0.06
        });
      } else if (view === 'setup') {
        enter(document.querySelectorAll('.trip-setup > div, .trip-setup > button'), {
          distance: 14,
          duration: 0.5,
          step: 0.07
        });
      } else if (view === 'board') {
        enter(document.querySelectorAll('.board-header, .identity-bar, .board-status, .claim-column, .organizer-tools'), {
          distance: 14,
          duration: 0.52,
          step: 0.065
        });
      }
    });
  }

  document.addEventListener('starcamp:view-changed', event => {
    animatePlannerView(event.detail?.view);
  });

  document.addEventListener('starcamp:board-rendered', () => {
    window.requestAnimationFrame(() => {
      const changed = [];
      document.querySelectorAll('.claim-item').forEach(element => {
        const key = element.dataset.itemKey;
        const nextState = element.classList.contains('is-claimed') ? 'claimed' : 'needed';
        if (claimStates.get(key) !== nextState) changed.push(element);
        claimStates.set(key, nextState);
      });
      enter(changed, { distance: 9, duration: 0.4, step: 0.025 });
    });
  });
})();
