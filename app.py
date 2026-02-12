from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_from_directory
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import os
from datetime import datetime
import re
from pathlib import Path

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = os.getenv('DB_PATH', str(BASE_DIR / 'gallery.db'))
app.config['UPLOAD_FOLDER'] = os.getenv('UPLOAD_FOLDER', 'static/uploads')
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max file size
app.secret_key = os.getenv('SECRET_KEY', 'change-this-in-production')
ALLOWED_EXTENSIONS = {'jpg', 'jpeg'}

# Criar pasta de uploads se não existir
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS images
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  filename TEXT NOT NULL,
                  description TEXT,
                  likes INTEGER DEFAULT 0,
                  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS admins
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT UNIQUE NOT NULL,
                  password TEXT NOT NULL,
                  email TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS likes
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  image_id INTEGER,
                  email TEXT,
                  liked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY(image_id) REFERENCES images(id),
                  UNIQUE(image_id, email))''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS comments
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  image_id INTEGER,
                  email TEXT NOT NULL,
                  text TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY(image_id) REFERENCES images(id))''')
    
    # Criar admins padrão se não existirem
    try:
        c.execute('INSERT INTO admins (username, password, email) VALUES (?, ?, ?)',
                  ('admin1', generate_password_hash('123456'), 'admin1@gmail.com'))
        c.execute('INSERT INTO admins (username, password, email) VALUES (?, ?, ?)',
                  ('admin2', generate_password_hash('123456'), 'admin2@gmail.com'))
        conn.commit()
    except:
        pass
    
    conn.close()

# Inicializar banco de dados
init_db()

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT * FROM admins WHERE username = ?', (username,))
        admin = c.fetchone()
        conn.close()
        
        if admin and check_password_hash(admin['password'], password):
            session['admin_id'] = admin['id']
            session['username'] = admin['username']
            return redirect(url_for('admin'))
        else:
            return render_template('login.html', error='Usuário ou senha inválidos')
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

def is_admin():
    return 'admin_id' in session

@app.route('/')
def index():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM images ORDER BY uploaded_at DESC')
    images = c.fetchall()
    conn.close()
    return render_template('index.html', images=images)

@app.route('/api/images')
def get_images():
    search = request.args.get('search', '').lower()
    sort = request.args.get('sort', 'recent')  # recent, likes, oldest
    
    conn = get_db()
    c = conn.cursor()
    
    if sort == 'likes':
        c.execute('SELECT id, title, filename, description, likes, uploaded_at FROM images ORDER BY likes DESC')
    elif sort == 'oldest':
        c.execute('SELECT id, title, filename, description, likes, uploaded_at FROM images ORDER BY uploaded_at ASC')
    else:  # recent (default)
        c.execute('SELECT id, title, filename, description, likes, uploaded_at FROM images ORDER BY uploaded_at DESC')
    
    images = [dict(row) for row in c.fetchall()]
    conn.close()
    
    # Filtrar por pesquisa
    if search:
        images = [
            img for img in images
            if search in (img['title'] or '').lower()
            or search in (img['description'] or '').lower()
        ]
    
    return jsonify(images)

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/comments/<int:image_id>', methods=['GET'])
def get_comments(image_id):
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT email, text, created_at FROM comments WHERE image_id = ? ORDER BY created_at DESC LIMIT 20', (image_id,))
    comments = [{'email': row['email'], 'text': row['text'], 'created_at': row['created_at']} for row in c.fetchall()]
    conn.close()
    return jsonify(comments)

@app.route('/api/comments/<int:image_id>', methods=['POST'])
def add_comment(image_id):
    email = request.json.get('email', '').strip()
    text = request.json.get('text', '').strip()
    
    if not email or not validate_email(email):
        return jsonify({'error': 'Email inválido'}), 400
    
    if not text or len(text) < 2:
        return jsonify({'error': 'Comentário muito curto'}), 400
    
    if len(text) > 500:
        return jsonify({'error': 'Comentário muito longo (máximo 500 caracteres)'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    # Verificar se imagem existe
    c.execute('SELECT id FROM images WHERE id = ?', (image_id,))
    if not c.fetchone():
        conn.close()
        return jsonify({'error': 'Imagem não encontrada'}), 404
    
    c.execute('INSERT INTO comments (image_id, email, text) VALUES (?, ?, ?)', (image_id, email, text))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/like/<int:image_id>', methods=['POST'])
def like_image(image_id):
    email = request.json.get('email', '').strip()
    
    if not email or not validate_email(email):
        return jsonify({'error': 'Email inválido'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    # Verificar se a imagem existe
    c.execute('SELECT likes FROM images WHERE id = ?', (image_id,))
    result = c.fetchone()
    
    if not result:
        conn.close()
        return jsonify({'error': 'Image not found'}), 404
    
    # Alternar like: se já existe, remove; se não existe, adiciona
    c.execute('SELECT id FROM likes WHERE image_id = ? AND email = ?', (image_id, email))
    existing = c.fetchone()
    if existing:
        c.execute('DELETE FROM likes WHERE id = ?', (existing['id'],))
        c.execute('UPDATE images SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id = ?', (image_id,))
        liked = False
    else:
        c.execute('INSERT INTO likes (image_id, email) VALUES (?, ?)', (image_id, email))
        c.execute('UPDATE images SET likes = likes + 1 WHERE id = ?', (image_id,))
        liked = True
    conn.commit()
    
    c.execute('SELECT likes FROM images WHERE id = ?', (image_id,))
    result = c.fetchone()
    conn.close()
    
    return jsonify({'likes': result['likes'], 'liked': liked})


@app.route('/admin')
def admin():
    if not is_admin():
        return redirect(url_for('login'))
    
    conn = get_db()
    c = conn.cursor()
    
    # Dados para gráficos
    c.execute('SELECT COUNT(*) as total FROM images')
    total_images = c.fetchone()['total']
    
    c.execute('SELECT SUM(likes) as total_likes FROM images')
    total_likes = c.fetchone()['total_likes'] or 0
    
    c.execute('SELECT title, likes FROM images ORDER BY likes DESC LIMIT 5')
    top_images = [dict(row) for row in c.fetchall()]
    
    c.execute('''SELECT DATE(uploaded_at) as date, COUNT(*) as count 
                 FROM images GROUP BY DATE(uploaded_at) ORDER BY date DESC LIMIT 10''')
    upload_stats = [dict(row) for row in c.fetchall()]
    
    c.execute('SELECT * FROM images ORDER BY uploaded_at DESC')
    images = c.fetchall()
    conn.close()
    
    return render_template('admin.html', 
                         images=images,
                         total_images=total_images,
                         total_likes=total_likes,
                         top_images=top_images,
                         upload_stats=upload_stats,
                         username=session.get('username'))


@app.route('/upload', methods=['GET', 'POST'])
def upload():
    if not is_admin():
        return redirect(url_for('login'))
    
    error = None
    if request.method == 'POST':
        if 'file' not in request.files:
            error = '❌ Nenhum arquivo selecionado'
        else:
            file = request.files['file']
            title = request.form.get('title', '').strip()
            description = request.form.get('description', '')
            
            # Validar título
            if not title:
                error = '❌ O título é obrigatório'
            
            # Validar arquivo
            elif file.filename == '':
                error = '❌ Nenhum arquivo selecionado'
            
            # Validar extensão (APENAS JPG)
            elif not allowed_file(file.filename):
                error = f'❌ Erro: Apenas JPG são permitidos! Você enviou: {file.filename}'
            
            # Validar MIME type
            elif file.content_type not in ['image/jpeg']:
                error = f'❌ Erro: O tipo de arquivo deve ser JPG (image/jpeg)! Tipo recebido: {file.content_type}'
            
            # Validar tamanho
            elif file.content_length and file.content_length > 5 * 1024 * 1024:
                size_mb = file.content_length / (1024 * 1024)
                error = f'❌ Arquivo muito grande: {size_mb:.2f}MB (máximo 5MB)'
            
            # Se passou todas as validações
            elif file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                timestamp = int(datetime.now().timestamp() * 1000)
                filename = f"{timestamp}-{filename}"
                
                file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
                
                conn = get_db()
                c = conn.cursor()
                c.execute('INSERT INTO images (title, filename, description) VALUES (?, ?, ?)',
                         (title, filename, description))
                conn.commit()
                conn.close()
                
                return redirect(url_for('admin'))
    
    return render_template('upload.html', error=error)

@app.route('/delete/<int:image_id>', methods=['POST'])
def delete_image(image_id):
    if not is_admin():
        return redirect(url_for('login'))
    
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT filename FROM images WHERE id = ?', (image_id,))
    result = c.fetchone()
    
    if result:
        filename = result['filename']
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(filepath):
            os.remove(filepath)
        
        c.execute('DELETE FROM images WHERE id = ?', (image_id,))
        conn.commit()
    
    conn.close()
    return redirect(url_for('admin'))

if __name__ == '__main__':
    app.run(
        debug=os.getenv('FLASK_DEBUG', '0') == '1',
        host='0.0.0.0',
        port=int(os.getenv('PORT', '5000'))
    )
