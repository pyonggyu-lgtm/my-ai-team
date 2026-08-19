(() => {
  const NICKNAME_KEY = 'rr_nickname';

  const nicknameScreen = document.getElementById('nickname-screen');
  const mainScreen = document.getElementById('main-screen');
  const nicknameInput = document.getElementById('nickname-input');
  const nicknameSubmit = document.getElementById('nickname-submit');
  const meLabel = document.getElementById('me-label');
  const changeNameBtn = document.getElementById('change-name');

  const addForm = document.getElementById('add-form');
  const restaurantInput = document.getElementById('restaurant-input');
  const listEl = document.getElementById('restaurant-list');
  const countBadge = document.getElementById('count-badge');
  const emptyHint = document.getElementById('empty-hint');

  const spinBtn = document.getElementById('spin-btn');
  const resultBanner = document.getElementById('result-banner');
  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');

  const COLORS = ['#ff7a59', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff5c7a', '#f4a261', '#90be6d'];

  let nickname = localStorage.getItem(NICKNAME_KEY) || '';
  let restaurants = [];
  let rotation = 0;
  let spinning = false;
  let socket = null;

  function showScreen(nameSet) {
    if (nameSet) {
      nicknameScreen.classList.add('hidden');
      mainScreen.classList.remove('hidden');
      meLabel.textContent = `${nickname}님`;
    } else {
      nicknameScreen.classList.remove('hidden');
      mainScreen.classList.add('hidden');
      nicknameInput.value = nickname;
      nicknameInput.focus();
    }
  }

  function setNickname(value) {
    nickname = value.trim();
    if (!nickname) return;
    localStorage.setItem(NICKNAME_KEY, nickname);
    showScreen(true);
    connectSocket();
  }

  nicknameSubmit.addEventListener('click', () => setNickname(nicknameInput.value));
  nicknameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setNickname(nicknameInput.value);
  });

  changeNameBtn.addEventListener('click', () => {
    showScreen(false);
  });

  function drawWheel() {
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 6;

    ctx.clearRect(0, 0, size, size);

    if (restaurants.length === 0) {
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#3a2450';
      ctx.fill();
      ctx.fillStyle = '#b9a7c9';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('식당을 추가해주세요', center, center);
      return;
    }

    const seg = (Math.PI * 2) / restaurants.length;

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(rotation);

    restaurants.forEach((r, i) => {
      const start = i * seg;
      const end = start + seg;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();

      ctx.save();
      ctx.rotate(start + seg / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1b1023';
      ctx.font = 'bold 13px sans-serif';
      const label = r.name.length > 10 ? `${r.name.slice(0, 9)}…` : r.name;
      ctx.fillText(label, radius - 12, 4);
      ctx.restore();
    });

    ctx.restore();
  }

  function renderList() {
    listEl.innerHTML = '';
    countBadge.textContent = restaurants.length;
    emptyHint.classList.toggle('hidden', restaurants.length > 0);

    restaurants.forEach((r) => {
      const li = document.createElement('li');

      const left = document.createElement('span');
      left.innerHTML = `<span class="name">${escapeHtml(r.name)}</span><span class="owner">${escapeHtml(r.addedBy)}</span>`;
      li.appendChild(left);

      if (r.addedBy === nickname) {
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '삭제';
        delBtn.addEventListener('click', () => deleteRestaurant(r.id));
        li.appendChild(delBtn);
      }

      listEl.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function updateSpinAvailability() {
    spinBtn.disabled = spinning || restaurants.length < 2;
  }

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = restaurantInput.value.trim();
    if (!name) return;

    const res = await fetch('/api/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, addedBy: nickname }),
    });

    if (res.ok) {
      restaurantInput.value = '';
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '식당을 추가하지 못했습니다.');
    }
  });

  async function deleteRestaurant(id) {
    await fetch(`/api/restaurants/${id}`, { method: 'DELETE' });
  }

  spinBtn.addEventListener('click', async () => {
    if (spinning || restaurants.length < 2) return;
    spinBtn.disabled = true;
    resultBanner.classList.add('hidden');

    const res = await fetch('/api/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spunBy: nickname }),
    });

    if (!res.ok) {
      spinBtn.disabled = false;
      const data = await res.json().catch(() => ({}));
      alert(data.error || '룰렛을 돌리지 못했습니다.');
    }
  });

  function animateSpinTo(winnerId, spunBy, winnerName) {
    const index = restaurants.findIndex((r) => r.id === winnerId);
    if (index === -1) return;

    spinning = true;
    updateSpinAvailability();

    const seg = (Math.PI * 2) / restaurants.length;
    const targetAngle = index * seg + seg / 2;
    const twoPi = Math.PI * 2;

    const targetMod = mod(-Math.PI / 2 - targetAngle, twoPi);
    const currentMod = mod(rotation, twoPi);
    const diff = mod(targetMod - currentMod, twoPi);

    const extraSpins = 6 * twoPi;
    const totalDelta = extraSpins + diff;
    const startRotation = rotation;
    const endRotation = rotation + totalDelta;

    const duration = 4200;
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      rotation = startRotation + totalDelta * eased;
      drawWheel();

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        rotation = endRotation;
        drawWheel();
        spinning = false;
        updateSpinAvailability();
        resultBanner.innerHTML = `<strong>${escapeHtml(winnerName)}</strong> 당첨! 🎉 (${escapeHtml(spunBy)}님이 돌림)`;
        resultBanner.classList.remove('hidden');
      }
    }

    requestAnimationFrame(frame);
  }

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function connectSocket() {
    if (socket) return;
    socket = io();

    socket.on('restaurants:update', (data) => {
      restaurants = data;
      renderList();
      drawWheel();
      updateSpinAvailability();
    });

    socket.on('spin:result', (spin) => {
      animateSpinTo(spin.winnerId, spin.spunBy, spin.winnerName);
    });
  }

  drawWheel();
  showScreen(Boolean(nickname));
  if (nickname) connectSocket();
})();
