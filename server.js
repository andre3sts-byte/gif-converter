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

 Criar pasta uploads se não existir
const uploadDir = path.join(os.tmpdir(), 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive true });
}

const storage = multer.diskStorage({
    destination uploadDir,
    filename (req, file, cb) = {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage storage,
    limits { fileSize 50  1024  1024 }  50MB limite
});

 Rota de health check para acordar o servidor
app.get('health', (req, res) = {
    res.send('OK');
});

 Rota principal de conversão
app.post('convert', upload.single('video'), (req, res) = {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado');
    }

    const inputPath = req.file.path;
    const outputPath = inputPath + '.gif';
    
    console.log('Convertendo', inputPath);
    
    ffmpeg(inputPath)
        .outputOptions([
            '-vf', 'fps=30,scale=300-1flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
            '-loop', '0'
        ])
        .output(outputPath)
        .on('end', () = {
            console.log('Conversão concluída');
            
             Enviar GIF
            res.download(outputPath, 'animation.gif', (err) = {
                 Limpar arquivos temporários
                try {
                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);
                } catch (e) {
                    console.error('Erro ao limpar arquivos', e);
                }
            });
        })
        .on('error', (err) = {
            console.error('Erro na conversão', err);
            res.status(500).send('Erro na conversão ' + err.message);
            
             Limpar arquivo de entrada em caso de erro
            try {
                fs.unlinkSync(inputPath);
            } catch (e) {}
        })
        .run();
});

const PORT = process.env.PORT  3000;
app.listen(PORT, () = {
    console.log(`Servidor rodando na porta ${PORT}`);
});