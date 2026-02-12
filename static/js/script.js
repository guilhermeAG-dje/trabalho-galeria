const state = {
    currentImageId: null,
    currentSort: 'recent',
    currentImages: [],
    currentImageIndex: -1
};

console.log('script.js loaded');

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupSearchAndFilters();
    setupThemeToggle();
    setupModal();
    setupEmailModalClose();
    loadImages();
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) themeToggle.textContent = '☀️';
    }
}

function setupThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) return;

    themeToggle.addEventListener('click', function() {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        this.textContent = isDark ? '☀️' : '🌙';
    });
}

function setupSearchAndFilters() {
    const searchInput = document.getElementById('searchInput');
    const filterButtons = document.querySelectorAll('.filter-btn');

    if (searchInput) {
        searchInput.addEventListener('input', debounce(loadImages, 300));
    }

    filterButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            filterButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            state.currentSort = this.dataset.sort;
            loadImages();
        });
    });
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function loadImages() {
    const searchTerm = document.getElementById('searchInput')?.value || '';
    const url = `/api/images?search=${encodeURIComponent(searchTerm)}&sort=${state.currentSort}`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            state.currentImages = data;
            const gallery = document.getElementById('gallery');
            if (!gallery) return;

            gallery.innerHTML = '';

            if (!data.length) {
                gallery.innerHTML = '<p style="text-align:center;grid-column:1/-1;padding:2rem;color:var(--text-secondary);"><strong>Nenhuma imagem encontrada</strong></p>';
                return;
            }

            data.forEach(image => {
                const title = escapeHtml(image.title || '');
                const description = escapeHtml(image.description || '');
                const filename = escapeHtml(image.filename || '');

                const item = document.createElement('div');
                item.className = 'gallery-item';
                item.innerHTML = `
                    <img src="/uploads/${filename}" alt="${title}" onclick="openModalById(${image.id})">
                    <div class="gallery-item-info">
                        <h3>${title}</h3>
                        <p>${description}</p>
                        <div class="gallery-actions">
                            <button class="favorite-btn" onclick="toggleFavorite(event, ${image.id}, '${title}')">🤍</button>
                            <button class="like-btn" onclick="openEmailModal(${image.id})">❤️</button>
                            <span class="like-count">${image.likes}</span>
                        </div>
                    </div>
                `;
                gallery.appendChild(item);
            });

            initFavorites();
        })
        .catch(error => console.error('Error loading images:', error));
}

function initFavorites() {
    const favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    document.querySelectorAll('.gallery-item').forEach(item => {
        const title = item.querySelector('h3')?.textContent || '';
        if (favorites.some(f => f.title === title)) {
            const favBtn = item.querySelector('.favorite-btn');
            if (favBtn) favBtn.classList.add('active');
        }
    });
}

function toggleFavorite(event, imageId, title) {
    event.stopPropagation();

    const target = event.currentTarget || event.target;
    let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
    const index = favorites.findIndex(f => f.id === imageId);

    if (index > -1) {
        favorites.splice(index, 1);
        target.classList.remove('active');
    } else {
        favorites.push({ id: imageId, title: title });
        target.classList.add('active');
    }

    localStorage.setItem('favorites', JSON.stringify(favorites));
}

function setupLightbox() {
    document.addEventListener('keydown', event => {
        const modal = document.getElementById('imageModal');
        if (!modal || modal.style.display !== 'block') return;

        if (event.key === 'ArrowLeft') previousImage();
        if (event.key === 'ArrowRight') nextImage();
        if (event.key === 'Escape') closeModal();
        if (event.key.toLowerCase() === 'f') toggleFullscreen();
    });
}

function nextImage() {
    if (state.currentImageIndex < 0 || state.currentImageIndex >= state.currentImages.length - 1) return;
    openModal(state.currentImages[state.currentImageIndex + 1]);
}

function previousImage() {
    if (state.currentImageIndex <= 0 || state.currentImageIndex > state.currentImages.length - 1) return;
    openModal(state.currentImages[state.currentImageIndex - 1]);
}

function zoomImage(direction) {
    const img = document.getElementById('modalImage');
    if (!img) return;

    let currentZoom = img.dataset.zoom ? parseFloat(img.dataset.zoom) : 1;
    if (direction === 'in') currentZoom += 0.2;
    if (direction === 'out' && currentZoom > 1) currentZoom -= 0.2;

    img.dataset.zoom = String(currentZoom);
    img.style.transform = `scale(${currentZoom})`;
    img.style.transition = 'transform 0.2s';
}

function toggleFullscreen() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.classList.toggle('fullscreen-modal');
}

function downloadImage() {
    if (state.currentImageIndex < 0 || !state.currentImages[state.currentImageIndex]) return;

    const image = state.currentImages[state.currentImageIndex];
    const link = document.createElement('a');
    link.href = `/uploads/${image.filename}`;
    link.download = image.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function shareImage() {
    if (state.currentImageIndex < 0 || !state.currentImages[state.currentImageIndex]) return;

    const image = state.currentImages[state.currentImageIndex];
    const title = image.title || 'Imagem';
    const url = `${window.location.origin}/uploads/${image.filename}`;
    const text = `Confira "${title}" na Visual Perspectives Gallery!`;

    if (navigator.share) {
        try {
            await navigator.share({ title, text, url });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }

    try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        alert('Link da imagem copiado para a área de transferência!');
    } catch (_) {
        const shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
        window.open(shareUrl, '_blank', 'width=600,height=400');
    }
}

function setupModal() {
    const modal = document.getElementById('imageModal');
    const closeBtn = document.querySelector('#imageModal .close');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    window.addEventListener('click', event => {
        if (event.target === modal) {
            closeModal();
        }
    });

    setupLightbox();
}

function setupEmailModalClose() {
    window.addEventListener('click', event => {
        const emailModal = document.getElementById('emailModal');
        if (emailModal && event.target === emailModal) {
            closeEmailModal();
        }
    });
}

function openModalById(imageId) {
    const index = state.currentImages.findIndex(img => img.id === imageId);
    if (index === -1) return;
    openModal(state.currentImages[index]);
}

function updateNavigationButtons() {
    const prevBtn = document.querySelector('.modal-btn.nav-btn[onclick="previousImage()"]');
    const nextBtn = document.querySelector('.modal-btn.nav-btn[onclick="nextImage()"]');

    if (prevBtn) prevBtn.disabled = state.currentImageIndex <= 0;
    if (nextBtn) nextBtn.disabled = state.currentImageIndex >= state.currentImages.length - 1;
}

function openModal(image) {
    if (!image) return;

    state.currentImageId = image.id;
    state.currentImageIndex = state.currentImages.findIndex(img => img.id === image.id);

    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalTitle = document.getElementById('modalTitle');
    const modalDesc = document.getElementById('modalDescription');
    const modalLikes = document.getElementById('modalLikes');

    modalImage.src = `/uploads/${image.filename}`;
    modalImage.dataset.zoom = '1';
    modalImage.style.transform = 'scale(1)';
    modalTitle.textContent = image.title || '';
    modalDesc.textContent = image.description || '';
    modalLikes.textContent = image.likes || 0;

    updateNavigationButtons();

    document.getElementById('commentsList').innerHTML = '';
    document.getElementById('commentEmail').value = '';
    document.getElementById('commentText').value = '';

    loadComments(image.id);
    modal.style.display = 'block';
}

function closeModal() {
    document.getElementById('imageModal').style.display = 'none';
    state.currentImageId = null;
    state.currentImageIndex = -1;
}

function loadComments(imageId) {
    fetch(`/api/comments/${imageId}`)
        .then(response => response.json())
        .then(data => {
            const commentsList = document.getElementById('commentsList');
            commentsList.innerHTML = '';

            if (!data.length) {
                commentsList.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:1rem;">Sem comentários ainda</p>';
                return;
            }

            data.forEach(comment => {
                const commentEl = document.createElement('div');
                commentEl.className = 'comment';
                const date = new Date(comment.created_at).toLocaleDateString('pt-BR');
                commentEl.innerHTML = `
                    <div class="comment-email">${escapeHtml(comment.email)}</div>
                    <div class="comment-text">${escapeHtml(comment.text)}</div>
                    <div class="comment-date">${date}</div>
                `;
                commentsList.appendChild(commentEl);
            });
        })
        .catch(error => console.error('Error loading comments:', error));
}

function submitComment(event) {
    event.preventDefault();

    const email = document.getElementById('commentEmail').value.trim();
    const text = document.getElementById('commentText').value.trim();

    if (!email || !text) {
        alert('Preencha email e comentário');
        return;
    }

    if (!isValidEmail(email)) {
        alert('Email inválido. Use: seuemail@dominio.com');
        return;
    }

    if (text.length < 2 || text.length > 500) {
        alert('Comentário deve ter entre 2 e 500 caracteres');
        return;
    }

    fetch(`/api/comments/${state.currentImageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, text })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert('❌ ' + data.error);
                return;
            }

            alert('💬 Comentário publicado!');
            document.getElementById('commentEmail').value = '';
            document.getElementById('commentText').value = '';
            loadComments(state.currentImageId);
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Erro ao publicar comentário');
        });
}

function openEmailModal(imageId) {
    state.currentImageId = imageId;
    document.getElementById('emailInput').value = '';
    document.getElementById('emailInput').focus();
    document.getElementById('emailModal').style.display = 'block';
}

function closeEmailModal() {
    document.getElementById('emailModal').style.display = 'none';
    document.getElementById('emailInput').value = '';
}

function submitLike() {
    const email = document.getElementById('emailInput').value.trim();

    if (!email) {
        alert('Digite um email válido');
        return;
    }

    if (!isValidEmail(email)) {
        alert('Email inválido. Use: seuemail@dominio.com');
        return;
    }

    if (state.currentImageId === null) {
        alert('Erro ao processar like');
        return;
    }

    fetch(`/api/like/${state.currentImageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert('❌ ' + data.error);
                return;
            }

            alert(data.liked ? '❤️ Like enviado com sucesso!' : '💔 Like removido!');
            closeEmailModal();
            loadImages();
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Erro ao processar like');
        });
}

function isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
