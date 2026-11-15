import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { SITE_URL } from '../config/runtime';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: 'website' | 'video.movie' | 'video.tv_show' | 'article';
  twitterCard?: 'summary' | 'summary_large_image';
  canonical?: string;
  hreflangLinks?: Array<{
    lang: string;
    href: string;
  }>;
}

const SEO: React.FC<SEOProps> = (props) => {
  const { t } = useTranslation();
  const {
    title = t('seo.defaultTitle'),
    description = t('seo.defaultDescription'),
    keywords = t('seo.defaultKeywords'),
    ogImage = `${SITE_URL}/og-image.jpg`,
    ogUrl = SITE_URL,
    ogType = 'website',
    twitterCard = 'summary_large_image',
    canonical = SITE_URL,
    hreflangLinks = [
      { lang: 'fr-FR', href: SITE_URL },
      { lang: 'fr-BE', href: SITE_URL },
      { lang: 'fr-CH', href: SITE_URL },
      { lang: 'fr-CA', href: SITE_URL },
      { lang: 'x-default', href: SITE_URL },
    ],
  } = props;
  const siteName = 'Movix';
  
  return (
    <Helmet>
      {/* Balises Title et Meta de base */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <link rel="canonical" href={canonical} />
      
      {/* Balises hreflang */}
      {hreflangLinks.map((link) => (
        <link key={link.lang} rel="alternate" hrefLang={link.lang} href={link.href} />
      ))}
      
      {/* Open Graph */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={ogUrl} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:site_name" content={siteName} />
      
      {/* Twitter Card */}
      <meta name="twitter:card" content={twitterCard} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      
      {/* Autres balises importantes */}
      <meta name="robots" content="index, follow" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta httpEquiv="Content-Type" content="text/html; charset=utf-8" />
    </Helmet>
  );
};

export default SEO; 
