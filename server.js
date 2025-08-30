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

// Nova rota para processar frames PNG
app.post('/convert-frames', upload.array('frames', 30), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Nenhum frame enviado' });
    }

    const { transparent = 'false', frameCount = '20', fps = '10' } = req.body;
    const isTransparent = transparent === 'true';
    const outputPath = path.join(uploadDir, Date.now() + '-animation.gif');
    
    console.log('Processando', req.files.length, 'frames PNG');
    console.log('Transparente:', isTransparent);

    // Ordenar arquivos por nome
    const sortedFiles = req.files.sort((a, b) => a.filename.localeCompare(b.filename));
    
    // Criar lista de inputs para FFmpeg
    const command = ffmpeg();
    
    sortedFiles.forEach(file => {
        command.input(file.path);
    });

    // Configurar filtro complexo para transparência
    const filterComplex = [
        // Converter todos os frames para o mesmo formato e aplicar transparência se necessário
        sortedFiles.map((_, i) => `[${i}:v]`).join('') + 
        `concat=n=${sortedFiles.length}:v=1:a=0,fps=${fps}` +
        (isTransparent ? `,format=rgba,colorkey=0x000000:0.01:0.1` : '') +
        `[v]`,
        
        // Gerar paleta otimizada
        `[v]split[s0][s1]`,
        `[s0]palettegen${isTransparent ? '=reserve_transparent=on:transparency_color=000000' : ''}[p]`,
        `[s1][p]paletteuse${isTransparent ? '=alpha_threshold=128' : ''}`
    ];

    command
        .complexFilter(filterComplex)
        .outputOptions([
            '-loop', '0',
            '-y'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
            console.log('FFmpeg iniciado:', cmd);
        })
        .on('progress', (progress) => {
            console.log('Progresso:', Math.round(progress.percent || 0) + '%');
        })
        .on('end', () => {
            console.log('GIF criado com sucesso');
            
            if (!fs.existsSync(outputPath)) {
                console.error('Arquivo GIF não foi criado');
                sortedFiles.forEach(file => safeUnlink(file.path));
                return res.status(500).json({ error: 'Falha na criação do GIF' });
            }

            const stats = fs.statSync(outputPath);
            console.log('GIF final - tamanho:', stats.size, 'bytes');

            res.download(outputPath, 'animation.gif', (err) => {
                // Limpar todos os arquivos
                sortedFiles.forEach(file => safeUnlink(file.path));
                safeUnlink(outputPath);
                if (err) {
                    console.error('Erro no download:', err);
                }
            });
        })
        .on('error', (err) => {
            console.error('Erro FFmpeg:', err.message);
            sortedFiles.forEach(file => safeUnlink(file.path));
            safeUnlink(outputPath);
            res.status(500).json({ 
                error: 'Erro na conversão FFmpeg', 
                details: err.message 
            });
        })
        .run();
});

// Rota antiga para compatibilidade (vídeo WebM)
app.post('/convert', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const inputPath = req.file.path;
    const outputPath = inputPath + '.gif';
    
    console.log('Convertendo vídeo:', inputPath);
    
    ffmpeg(inputPath)
        .outputOptions([
            '-vf', 'fps=10,scale=300:300:force_original_aspect_ratio=decrease,pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x00000000@0',
            '-f', 'gif',
            '-loop', '0',
            '-y'
        ])
        .output(outputPath)
        .on('end', () => {
            console.log('Conversão finalizada');
            
            if (!fs.existsSync(outputPath)) {
                safeUnlink(inputPath);
                return res.status(500).json({ error: 'Falha na criação do GIF' });
            }

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
            res.status(500).json({ error: 'Erro na conversão', details: err.message });
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
