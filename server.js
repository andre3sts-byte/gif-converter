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
   limits: { fileSize: 50 * 1024 * 1024 },
   fileFilter: (req, file, cb) => {
       if (file.mimetype.startsWith('video/')) {
           cb(null, true);
       } else {
           cb(new Error('Apenas arquivos de vídeo são aceitos'));
       }
   }
});

// Função para limpar arquivos com segurança
function safeUnlink(filePath) {
   try {
       if (fs.existsSync(filePath)) {
           fs.unlinkSync(filePath);
           console.log('Arquivo removido:', filePath);
       }
   } catch (e) {
       console.error('Erro ao remover arquivo:', filePath, e.message);
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
   
   console.log('Iniciando conversão:', {
       input: inputPath,
       output: outputPath,
       size: req.file.size
   });
   
   // Primeiro passo: criar paleta com transparência
   const paletteFilter = [
       'fps=15',
       'scale=300:300:force_original_aspect_ratio=decrease',
       'pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
       'palettegen=reserve_transparent=on:transparency_color=000000'
   ].join(',');
   
   // Segundo passo: aplicar paleta
   const useFilter = [
       'fps=15',
       'scale=300:300:force_original_aspect_ratio=decrease', 
       'pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x00000000'
   ].join(',');
   
   ffmpeg(inputPath)
       .complexFilter([
           `[0:v]${paletteFilter}[palette]`,
           `[0:v]${useFilter},split[video1][video2]`,
           '[video1][palette]paletteuse=alpha_threshold=128'
       ])
       .outputOptions([
           '-loop', '0',
           '-y'
       ])
       .output(outputPath)
       .on('start', (commandLine) => {
           console.log('FFmpeg comando:', commandLine);
       })
       .on('progress', (progress) => {
           console.log('Progresso:', Math.round(progress.percent || 0) + '%');
       })
       .on('end', () => {
           console.log('Conversão concluída');
           
           if (!fs.existsSync(outputPath)) {
               console.error('Arquivo GIF não foi criado');
               safeUnlink(inputPath);
               return res.status(500).json({ error: 'Falha na geração do GIF' });
           }

           const stats = fs.statSync(outputPath);
           console.log('GIF criado:', { tamanho: stats.size, arquivo: outputPath });

           res.download(outputPath, 'animation.gif', (err) => {
               if (err) {
                   console.error('Erro no download:', err);
               }
               safeUnlink(inputPath);
               safeUnlink(outputPath);
           });
       })
       .on('error', (err) => {
           console.error('Erro FFmpeg detalhado:', {
               message: err.message,
               stack: err.stack
           });
           
           safeUnlink(inputPath);
           safeUnlink(outputPath);
           
           res.status(500).json({ 
               error: 'Erro na conversão FFmpeg', 
               details: err.message 
           });
       })
       .run();
});

// Middleware de erro global
app.use((error, req, res, next) => {
   console.error('Erro não tratado:', error);
   res.status(500).json({ error: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
   console.log(`Servidor rodando na porta ${PORT}`);
});
