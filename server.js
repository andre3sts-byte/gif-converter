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

// Rota corrigida para frames PNG
app.post('/convert-frames', upload.array('frames', 30), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Nenhum frame enviado' });
    }

    const { transparent = 'false', fps = '10' } = req.body;
    const isTransparent = transparent === 'true';
    
    console.log('Processando', req.files.length, 'frames PNG');
    console.log('Transparente:', isTransparent);

    // Criar diretório temporário único
    const tempId = Date.now();
    const tempDir = path.join(uploadDir, `temp-${tempId}`);
    const outputPath = path.join(uploadDir, `animation-${tempId}.gif`);
    
    try {
        fs.mkdirSync(tempDir);
        
        // Copiar e renomear arquivos para sequência
        req.files
            .sort((a, b) => a.filename.localeCompare(b.filename))
            .forEach((file, i) => {
                const newPath = path.join(tempDir, `frame${String(i).padStart(3, '0')}.png`);
                fs.copyFileSync(file.path, newPath);
                console.log(`Copiado: ${file.filename} -> frame${String(i).padStart(3, '0')}.png`);
            });

        // Comando FFmpeg simplificado
        const inputPattern = path.join(tempDir, 'frame%03d.png');
        
        console.log('Input pattern:', inputPattern);
        console.log('Output path:', outputPath);

        ffmpeg()
            .input(inputPattern)
            .inputFPS(parseInt(fps))
            .outputOptions([
                '-y',
                '-loop', '0'
            ])
            .output(outputPath)
            .on('start', (cmd) => {
                console.log('FFmpeg comando:', cmd);
            })
            .on('progress', (progress) => {
                console.log('Progresso:', Math.round(progress.percent || 0) + '%');
            })
            .on('end', () => {
                console.log('GIF criado com sucesso');
                
                if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                    console.error('GIF não foi criado ou está vazio');
                    return res.status(500).json({ error: 'GIF não foi criado corretamente' });
                }

                const stats = fs.statSync(outputPath);
                console.log('GIF final - tamanho:', stats.size, 'bytes');

                res.download(outputPath, 'animation.gif', (err) => {
                    // Limpar arquivos
                    req.files.forEach(file => safeUnlink(file.path));
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    safeUnlink(outputPath);
                    
                    if (err) {
                        console.error('Erro no download:', err);
                    }
                });
            })
            .on('error', (err) => {
                console.error('Erro FFmpeg:', err);
                
                // Limpar arquivos
                req.files.forEach(file => safeUnlink(file.path));
                fs.rmSync(tempDir, { recursive: true, force: true });
                
                res.status(500).json({ 
                    error: 'Erro FFmpeg: ' + err.message 
                });
            })
            .run();
            
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).json({ error: 'Erro no processamento: ' + error.message });
    }
});

// Nova rota para AVI transparente
app.post('/convert-video', upload.array('frames', 50), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Nenhum frame enviado' });
    }

    const { format = 'avi', transparent = 'false', fps = '15' } = req.body;
    const isTransparent = transparent === 'true';
    
    console.log(`Processando ${req.files.length} frames para ${format.toUpperCase()}`);

    const tempId = Date.now();
    const tempDir = path.join(uploadDir, `temp-${tempId}`);
    const extension = format === 'avi' ? 'avi' : 'webm';
    const outputPath = path.join(uploadDir, `animation-${tempId}.${extension}`);
    
    try {
        fs.mkdirSync(tempDir);
        
        // Processar frames
        req.files
            .sort((a, b) => a.filename.localeCompare(b.filename))
            .forEach((file, i) => {
                const newPath = path.join(tempDir, `frame${String(i).padStart(3, '0')}.png`);
                fs.copyFileSync(file.path, newPath);
            });

        const inputPattern = path.join(tempDir, 'frame%03d.png');
        
        let command = ffmpeg()
            .input(inputPattern)
            .inputFPS(parseInt(fps));

        if (format === 'avi' && isTransparent) {
            // AVI com transparência usando codec UT Video
            command = command.outputOptions([
                '-c:v', 'utvideo', // Codec UT Video suporta alfa
                '-pix_fmt', 'rgba',
                '-y'
            ]);
        } else {
            // Fallback para WebM
            command = command.outputOptions([
                '-c:v', 'libvpx-vp9',
                '-pix_fmt', isTransparent ? 'yuva420p' : 'yuv420p',
                '-auto-alt-ref', '0',
                '-y'
            ]);
        }

        command
            .output(outputPath)
            .on('start', (cmd) => {
                console.log('FFmpeg comando:', cmd);
            })
            .on('end', () => {
                console.log(`${extension.toUpperCase()} criado com sucesso`);
                
                res.download(outputPath, `animation.${extension}`, (err) => {
                    req.files.forEach(file => safeUnlink(file.path));
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    safeUnlink(outputPath);
                    
                    if (err) console.error('Erro no download:', err);
                });
            })
            .on('error', (err) => {
                console.error(`Erro ${extension}:`, err);
                
                req.files.forEach(file => safeUnlink(file.path));
                fs.rmSync(tempDir, { recursive: true, force: true });
                
                res.status(500).json({ error: `Erro ${extension}: ` + err.message });
            })
            .run();
            
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).json({ error: 'Erro no processamento: ' + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
