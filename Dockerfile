# Usamos una imagen ligera de Node.js
FROM node:18-alpine

# Creamos la carpeta de la app dentro del contenedor
WORKDIR /app

# Copiamos los archivos de configuración primero
COPY package*.json ./

# Instalamos las librerías
RUN npm install

# Copiamos el resto del código
COPY . .

# Exponemos el puerto (Render usa esto)
EXPOSE 3000

# Comando para iniciar
CMD ["node", "app.js"]