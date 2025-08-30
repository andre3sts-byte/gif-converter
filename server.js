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
    limits: { fileSize: 50 * 1024 * 1024 }
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

app.post('/convert', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const inputPath = req.file.path;
    const outputPath = inputPath + '.gif';
    
    console.log('Convertendo arquivo:', inputPath, 'tamanho:', req.file.size);
    
    // Versão simplificada que funciona
    ffmpeg(inputPath)
        .outputOptions([
            '-vf', 'fps=10,scale=300:300:force_original_aspect_ratio=decrease,pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x00000000@0',
            '-f', 'gif',
            '-loop', '0',
            '-y'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
            console.log('FFmpeg iniciado:', cmd);
        })
        .on('stderr', (stderrLine) => {
            console.log('FFmpeg stderr:', stderrLine);
        })
        .on('end', () => {
            console.log('Conversão finalizada');
            
            if (!fs.existsSync(outputPath)) {
                console.error('Arquivo não foi criado');
                safeUnlink(inputPath);
                return res.status(500).json({ error: 'Falha na criação do GIF' });
            }

            const stats = fs.statSync(outputPath);
            console.log('GIF criado - tamanho:', stats.size, 'bytes');

            res.download(outputPath, 'animation.gif', (err) => {
                safeUnlink(inputPath);
                safeUnlink(outputPath);
                if (err) {
                    console.error('Erro no download:', err);
                }
            });
        })
        .on('error', (err) => {
            console.error('Erro FFmpeg:', err.message);
            safeUnlink(inputPath);
            safeUnlink(outputPath);
            res.status(500).json({ 
                error: 'Erro na conversão',
                details: err.message 
            });
        })
        .run();
});

app.use((error, req, res, next) => {
    console.error('Erro do servidor:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
