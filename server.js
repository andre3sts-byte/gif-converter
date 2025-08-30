const express = require('express');
const multer = require('multer');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

const uploadDir = path.join(os.tmpdir(), 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

function safeUnlink(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        console.error('Erro ao remover arquivo:', e.message);
    }
}

app.get('/', (req, res) => {
    res.send('GIF Converter Server is running!');
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Rota simplificada para frames PNG
app.post('/convert-frames', upload.array('frames', 30), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Nenhum frame enviado' });
    }

    const { transparent = 'false', fps = '10' } = req.body;
    const isTransparent = transparent === 'true';
    const outputPath = path.join(uploadDir, Date.now() + '-animation.gif');
    
    console.log('Processando', req.files.length, 'frames');
    console.log('Transparente:', isTransparent);

    // Ordenar arquivos
    const sortedFiles = req.files.sort((a, b) => a.filename.localeCompare(b.filename));
    
    // Comando simplificado
    const command = ffmpeg()
        .input(path.join(path.dirname(sortedFiles[0].path), 'frame-*.png'))
        .inputFPS(parseInt(fps))
        .outputOptions([
            '-vf', isTransparent ? 
                'palettegen=reserve_transparent=on:transparency_color=ffffff[p];[0:v][p]paletteuse=alpha_threshold=128' :
                'palettegen[p];[0:v][p]paletteuse',
            '-loop', '0',
            '-y'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
            console.log('FFmpeg:', cmd);
        })
        .on('end', () => {
            console.log('GIF criado');
            
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                console.error('GIF vazio ou não criado');
                sortedFiles.forEach(file => safeUnlink(file.path));
                return res.status(500).json({ error: 'GIF não foi criado corretamente' });
            }

            res.download(outputPath, 'animation.gif', (err) => {
                sortedFiles.forEach(file => safeUnlink(file.path));
                safeUnlink(outputPath);
                if (err) console.error('Erro no download:', err);
            });
        })
        .on('error', (err) => {
            console.error('Erro FFmpeg:', err);
            sortedFiles.forEach(file => safeUnlink(file.path));
            res.status(500).json({ error: 'Erro FFmpeg: ' + err.message });
        })
        .run();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
