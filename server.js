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

// Versão corrigida para transparência
app.post('/convert-frames', upload.array('frames', 30), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Nenhum frame enviado' });
    }

    const { transparent = 'false', fps = '10' } = req.body;
    const isTransparent = transparent === 'true';
    
    console.log('Processando', req.files.length, 'frames PNG');
    console.log('Transparente:', isTransparent);

    const tempId = Date.now();
    const tempDir = path.join(uploadDir, `temp-${tempId}`);
    const paletteFile = path.join(tempDir, 'palette.png');
    const outputPath = path.join(uploadDir, `animation-${tempId}.gif`);
    
    try {
        fs.mkdirSync(tempDir);
        
        // Copiar arquivos
        req.files
            .sort((a, b) => a.filename.localeCompare(b.filename))
            .forEach((file, i) => {
                const newPath = path.join(tempDir, `frame${String(i).padStart(3, '0')}.png`);
                fs.copyFileSync(file.path, newPath);
            });

        const inputPattern = path.join(tempDir, 'frame%03d.png');
        
        if (isTransparent) {
            // Processo em duas etapas para transparência
            console.log('Criando paleta com transparência...');
            
            // Etapa 1: Criar paleta
            ffmpeg()
                .input(inputPattern)
                .inputFPS(parseInt(fps))
                .outputOptions([
                    '-vf', 'palettegen=reserve_transparent=on:transparency_color=ffffff',
                    '-y'
                ])
                .output(paletteFile)
                .on('end', () => {
                    console.log('Paleta criada, gerando GIF transparente...');
                    
                    // Etapa 2: Criar GIF com paleta
                    ffmpeg()
                        .input(inputPattern)
                        .input(paletteFile)
                        .inputFPS(parseInt(fps))
                        .outputOptions([
                            '-lavfi', '[0:v][1:v]paletteuse=alpha_threshold=128',
                            '-loop', '0',
                            '-y'
                        ])
                        .output(outputPath)
                        .on('start', (cmd) => {
                            console.log('FFmpeg GIF transparente:', cmd);
                        })
                        .on('end', () => {
                            console.log('GIF transparente criado');
                            finishResponse();
                        })
                        .on('error', (err) => {
                            console.error('Erro GIF transparente:', err);
                            cleanup();
                            res.status(500).json({ error: 'Erro na criação do GIF transparente: ' + err.message });
                        })
                        .run();
                })
                .on('error', (err) => {
                    console.error('Erro na paleta:', err);
                    cleanup();
                    res.status(500).json({ error: 'Erro na criação da paleta: ' + err.message });
                })
                .run();
        } else {
            // GIF normal sem transparência
            console.log('Criando GIF normal...');
            
            ffmpeg()
                .input(inputPattern)
                .inputFPS(parseInt(fps))
                .outputOptions([
                    '-loop', '0',
                    '-y'
                ])
                .output(outputPath)
                .on('start', (cmd) => {
                    console.log('FFmpeg GIF normal:', cmd);
                })
                .on('end', () => {
                    console.log('GIF normal criado');
                    finishResponse();
                })
                .on('error', (err) => {
                    console.error('Erro GIF normal:', err);
                    cleanup();
                    res.status(500).json({ error: 'Erro na criação do GIF: ' + err.message });
                })
                .run();
        }
        
        function finishResponse() {
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                console.error('GIF não foi criado ou está vazio');
                cleanup();
                return res.status(500).json({ error: 'GIF não foi criado corretamente' });
            }

            const stats = fs.statSync(outputPath);
            console.log('GIF final - tamanho:', stats.size, 'bytes');

            res.download(outputPath, 'animation.gif', (err) => {
                cleanup();
                if (err) {
                    console.error('Erro no download:', err);
                }
            });
        }
        
        function cleanup() {
            req.files.forEach(file => safeUnlink(file.path));
            fs.rmSync(tempDir, { recursive: true, force: true });
            safeUnlink(outputPath);
        }
            
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).json({ error: 'Erro no processamento: ' + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
