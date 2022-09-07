// Importing all necessary dependencies
const QuickChart = require('quickchart-js');
const dotenv = require('dotenv');
const { Client } = require('@notionhq/client');
const axios = require('axios');
dotenv.config();

// Creating global variables that store our API credentials and other necessary information
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const pageId = process.env.NOTION_PAGE_ID;
const clientId = process.env.IMGUR_CLIENT_ID;

// This function is used to access the data from a Notion database given the database ID
async function queryDatabase(databaseId) {
    try {
        const response = await notion.databases.query({
            database_id: databaseId,
          });  
        return response.results;
    } catch (error){
        console.log(error.body);
    }
}

// This function is used to access up to 50 child blocks per page given the page ID
async function getChildBlocks(pageId) {
    try {
        const response = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 50,
          });
        return response.results;
    } catch (error){
        console.log(error.body);
    }
}

// This function will access the data from the given database, generate a chart with QuickChart,
// and return the QuickChart URL containing the chart image 
async function getChart(databaseId, chartType) {

    // Use the queryDatabase() function to acquire the data stored in our database
    const data = await queryDatabase(databaseId)
        .then(async results => {
	        // dataPts array will hold the score for each entry, labels array will hold each name
            const dataPts = [];
            const labels = [];
            
	        // Go through the results array and parse the pageId, nameId, and scoreId 
            for(i = 0; i < results.length; i++) {
                const pageId = results[i].id;
                const nameId = results[i].properties.Name.id;
                const scoreId = results[i].properties.Score.id;
	   
                // The above variables are needed to retrieve the values of each entry
                try {
                    const nameVal = await notion.pages.properties.retrieve({ 
                            page_id: pageId, 
                            property_id: nameId 
                    });
                    const scoreVal = await notion.pages.properties.retrieve({ 
                            page_id: pageId, 
                            property_id: scoreId 
                    });
         
	                // Store each Name and Score value to their respective arrays      
                    labels.push(nameVal.results[0].title.text.content);
                    dataPts.push(scoreVal.number);

                } catch (error){
                    console.log(error.body);
                }
            }
	        // Return the data in an object 
            return {"Labels":labels, "Data Points":dataPts};
        });

    // Initialize the QuickChart client, make the API call with the data and customizations
    const myChart = new QuickChart();
    myChart.setConfig({
        type: chartType,
        data: { labels: data["Labels"], 
        datasets: [{ label: 'Scores', data: data["Data Points"] }] },
    })
    .setWidth(800)
    .setHeight(400)
    .setBackgroundColor('transparent');

    // the chart URL
    // console.log(myChart.getUrl());
    return myChart.getUrl();
}


// This function will take the QuickChart link and upload it to Imgur and return the Imgur link
async function swapLinks(clientId, chartlink) {

    const imgurLink = await axios
        .post('https://api.imgur.com/3/image', chartlink, {
            headers: {
                Accept: "application/json",
                Authorization: `Client-ID ${clientId}`,
            },
        })
        .then(({data}) => {
          return data.data.link;
      });
    
    // console.log(imgurLink);
    return imgurLink;
}

// Will search through the results array, get each blockId, and replace
// all image blocks with the imgUrls array argument in order
function replaceCharts(pageId, imgUrls) {

    getChildBlocks(pageId)
    .then(async results => {
        // Get locations and ID's for previous images
        const prevImages = [];
        const allBlockIds = [];
        const indexLocations = [];

        // Reconstruct the children array + gather all ID's
        const children = new Array(results.length).fill(0);

        for(i = 0; i < results.length; i++) {
            allBlockIds.push(results[i].id)

            // If block is an image, store it in prevImage cache and save index
            // If not, store the block as-is into children array
            if(results[i].type == 'image') {
                prevImages.push(results[i].id);
                indexLocations.push(i);
            } else {
                const dataType = results[i]['type'];
                children[i] = { [dataType] : results[i][dataType] };
            }
        }

        // Now add new images to children array
        for(i = 0; i < imgUrls.length; i++) {
            const img =           
            {
                "image" : {
                    "caption": [],
                    "type": "external",
                    "external": {
                        "url": imgUrls[i],
                    }
                },
            }
            const index = indexLocations.shift();
            children[index] = img;
        }
        
        // Go through all current blocks, delete, then append children
        for (i = 0; i < allBlockIds.length; i++) {            
            await notion.blocks.delete({
                block_id: allBlockIds[i],
            });
        }

        // Append children
        await notion.blocks.children.append({
            block_id: pageId,
            children: children,
        });
    });
}

// The main driver of the program
async function refreshPage(databaseId, pageId, clientId, chartType) {

    // 1 - Get the QuickChart link from getChart()
    const quickChart = await getChart(databaseId, chartType);
  
    // 2 - Swap links from QuickChart to Imgur
    const imgurUrl = await swapLinks(clientId, quickChart);

    // 3 - Replace images on Notion page
    replaceCharts(pageId, [imgurUrl]);
}

// refreshPage(databaseId, pageId, clientId, 'pie');
