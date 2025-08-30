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
    const paletteePath = inputPath + '_palette.png';
    const outputPath = inputPath + '.gif';
    
    console.log('Convertendo com transparência:', inputPath);
    
    // Primeiro: gerar paleta com transparência
    ffmpeg(inputPath)
        .outputOptions([
            '-vf', 'fps=10,scale=300:300:force_original_aspect_ratio=decrease,pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x00000000@0,palettegen=reserve_transparent=on:transparency_color=000000',
            '-y'
        ])
        .output(paletteePath)
        .on('end', () => {
            console.log('Paleta criada, gerando GIF...');
            
            // Segundo: criar GIF usando a paleta
            ffmpeg()
                .input(inputPath)
                .input(paletteePath)
                .outputOptions([
                    '-filter_complex', 'fps=10,scale=300:300:force_original_aspect_ratio=decrease,pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x00000000@0[v];[v][1:v]paletteuse=alpha_threshold=128',
                    '-loop', '0',
                    '-y'
                ])
                .output(outputPath)
                .on('end', () => {
                    console.log('GIF com transparência criado');
                    
                    if (!fs.existsSync(outputPath)) {
                        safeUnlink(inputPath);
                        safeUnlink(paletteePath);
                        return res.status(500).json({ error: 'Falha na criação do GIF' });
                    }

                    const stats = fs.statSync(outputPath);
                    console.log('GIF final - tamanho:', stats.size, 'bytes');

                    res.download(outputPath, 'animation.gif', (err) => {
                        safeUnlink(inputPath);
                        safeUnlink(paletteePath);
                        safeUnlink(outputPath);
                        if (err) {
                            console.error('Erro no download:', err);
                        }
                    });
                })
                .on('error', (err) => {
                    console.error('Erro na criação do GIF:', err.message);
                    safeUnlink(inputPath);
                    safeUnlink(paletteePath);
                    safeUnlink(outputPath);
                    res.status(500).json({ error: 'Erro na geração do GIF', details: err.message });
                })
                .run();
        })
        .on('error', (err) => {
            console.error('Erro na criação da paleta:', err.message);
            safeUnlink(inputPath);
            safeUnlink(paletteePath);
            res.status(500).json({ error: 'Erro na criação da paleta', details: err.message });
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
