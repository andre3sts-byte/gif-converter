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

app.get('/', (req, res) => {
    res.send('GIF Converter Server is running!');
});

app.get('/health', (req, res) => {
    res.send('OK');
});

app.post('/convert', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado');
    }

    const inputPath = req.file.path;
    const outputPath = inputPath + '.gif';
    
    console.log('Convertendo:', inputPath);
    
    ffmpeg(inputPath)
       .outputOptions([
    '-vf', 'fps=30,scale=300:-1:flags=lanczos,format=rgba,split[s0][s1];[s0]palettegen=reserve_transparent=1:transparency_color=000000[p];[s1][p]paletteuse=alpha_threshold=128',
    '-gifflags', '+transdiff',
    '-loop', '0'
])
        .output(outputPath)
        .on('end', () => {
            console.log('Conversao concluida');
            
            res.download(outputPath, 'animation.gif', (err) => {
                try {
                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);
                } catch (e) {
                    console.error('Erro ao limpar arquivos:', e);
                }
            });
        })
        .on('error', (err) => {
            console.error('Erro na conversao:', err);
            res.status(500).send('Erro na conversao: ' + err.message);
            
            try {
                fs.unlinkSync(inputPath);
            } catch (e) {
                console.error('Erro ao limpar:', e);
            }
        })
        .run();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

