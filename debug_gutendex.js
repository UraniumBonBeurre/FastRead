const axios = require('axios');

async function checkFormats() {
  try {
    const response = await axios.get('https://gutendex.com/books');
    const books = response.data.results.slice(0, 5);
    
    books.forEach(book => {
      console.log(`Title: ${book.title}`);
      console.log('Formats:', JSON.stringify(book.formats, null, 2));
      console.log('-------------------');
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

checkFormats();
