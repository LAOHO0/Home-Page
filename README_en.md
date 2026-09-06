# SB33 Tech Pages

A clean, beautiful, and highly configurable personal homepage template built with pure frontend technologies. No backend required.

## ✨ Features

- 🎨 **Beautiful Design** - Dark theme with Unsplash random landscape backgrounds
- 📱 **Fully Responsive** - Works perfectly on desktop and mobile devices
- ⚡ **Skeleton Screen Loading** - Enhances first-screen experience with smooth transitions
- 🖼️ **Background Management** - Support for locking/switching wallpapers with mobile gesture controls
- ✍️ **Quote Display** - Typewriter effect for inspirational quotes
- 📊 **GitHub Contributions** - Automatically displays your GitHub activity
- 🔧 **Fully Configurable** - Customize everything by editing `config.json`
- 🚀 **Zero Dependencies** - Pure HTML/CSS/JavaScript, no build tools needed

## 🚀 Quick Start

### 1. Fork the Project

Click the **"Fork"** button in the top right corner of GitHub.

### 2. Modify Configuration

1. Copy `config.example.json` to `config.json`
2. Edit `config.json` and modify the following:

```json
{
  "pageTitle": "Your Name - Personal Homepage",
  "heading": {
    "mainTitle": "Welcome",
    "subTitle": "Hi, I'm XXX"
  },
  "name": "your_username",
  "displayName": "Your Name",
  "bio": "Developer | Dreamer",
  "url": "https://yourdomain.com",
  "github": {
    "username": "your_github_username",
    "showContributions": true
  },
  "socials": [
    {
      "name": "GitHub",
      "icon": "github",
      "url": "https://github.com/your_username",
      "enabled": true
    }
  ]
}
```

### 3. Deploy to GitHub Pages

1. Go to **Settings** → **Pages** in your repository
2. **Source**: Select "Deploy from a branch"
3. **Branch**: Select "main", folder: "/ (root)"
4. Click **Save**, wait a few minutes, then visit your site

### 4. Custom Domain (Optional)

1. Edit the `CNAME` file with your domain name
2. Add a CNAME record in your DNS pointing to `yourusername.github.io`

## 📁 File Structure

```
├── index.html              # Main page
├── styles.css              # Stylesheet
├── script.js               # JavaScript logic
├── config.json             # Configuration (modify this)
├── config.example.json     # Configuration example
├── quotes.json             # Quotes file
├── CNAME                   # Custom domain configuration
└── README_en.md            # This file
```

## 🔧 Complete Configuration Guide

### Page Title

```json
{
  "pageTitle": "Browser tab title"
}
```

### Homepage Heading

```json
{
  "heading": {
    "mainTitle": "Main title on homepage",
    "subTitle": "Subtitle (displayed before bio)"
  }
}
```

### Bio

```json
{
  "bio": "Developer | Dreamer | Open Source Enthusiast"
}
```

### GitHub Contributions

```json
{
  "github": {
    "username": "Your GitHub username",
    "showContributions": true
  }
}
```

### Social Links

Supported icons:
- `x` - X (Twitter)
- `github` - GitHub
- `email` - Email
- `blog` - Blog
- `telegram` - Telegram
- `youtube` - YouTube
- `instagram` - Instagram
- `linkedin` - LinkedIn
- `discord` - Discord
- `website` - Generic website

```json
{
  "socials": [
    {
      "name": "Display name",
      "icon": "github",
      "url": "Link URL",
      "enabled": true
    }
  ]
}
```

### Quotes (Hitokoto)

```json
{
  "hitokoto": {
    "enabled": true,
    "customQuotes": [
      {
        "content": "Quote content",
        "author": "Author name"
      }
    ]
  }
}
```

- `enabled`: Set to `false` to hide the quotes section
- `customQuotes`: Custom quotes (displayed with priority)

### Quotes File

All quotes are stored in `quotes.json`:

```json
[
  {
    "content": "Quote content",
    "author": "Author name"
  }
]
```

Edit this file directly to add, remove, or modify quotes.

### SEO Configuration

```json
{
  "seo": {
    "description": "Page description",
    "keywords": "keyword1, keyword2",
    "author": "Author name",
    "twitter": "@yourTwitter"
  }
}
```

### Theme Color

```json
{
  "theme": {
    "primaryColor": "#6366f1"
  }
}
```

### Site Launch Date

```json
{
  "site": {
    "startDate": "2024-01-01"
  }
}
```

Used to display "This site has been running for X days X hours X minutes X seconds".

## 🖼️ Background Image Controls

### Desktop
- Click the lock button in the top right: Lock/unlock current background

### Mobile
- **Swipe left/right**: Switch background image
- **Double tap**: Refresh background image
- **Long press lock button**: Show quick menu (lock/refresh/copy link)

## 📝 Complete Configuration Example

See `config.example.json` for a full example.

## 🔧 Local Development

Simply open `index.html` in your browser to preview (uses default configuration).

## 📄 License

MIT License - Free to use and modify.

---

[中文版](./README.md)
