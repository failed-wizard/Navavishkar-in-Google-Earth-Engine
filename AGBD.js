/**** Start of imports. If edited, may not auto-convert in the playground. ****/
var geometry = 
    /* color: #0000ff */
    /* shown: false */
    /* displayProperties: [
      {
        "type": "rectangle"
      }
    ] */
    ee.Geometry.Polygon(
        [[[79.80162266165273, 12.025937136179614],
          [79.80162266165273, 11.99504286925481],
          [79.83063343435781, 11.99504286925481],
          [79.83063343435781, 12.025937136179614]]], null, false);
/***** End of imports. If edited, may not auto-convert in the playground. *****/
var boundary = ee.FeatureCollection(geometry);

//Load Sentinel-2 Data
var s2 = ee.ImageCollection('COPERNICUS/S2_SR');

//Mask clouds using the Sentinel-2 QA band
function maskS2clouds(image) {
  var qa = image.select('QA60');

  var cloudBitMask = ee.Number(2).pow(10).int();
  var cirrusBitMask = ee.Number(2).pow(11).int();

  var mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(
             qa.bitwiseAnd(cirrusBitMask).eq(0));

  return image.updateMask(mask).divide(10000);
}

//Filter clouds from Sentinel-2
var composite = s2.filterDate('2022-06-01', '2022-10-01')
                  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 25))
                  .map(maskS2clouds)
                  .select('B3', 'B4','B5','B6','B7','B8','B11'); 

//Reproject to WGS 84 UTM zone 44N                  
var S2_composite = composite.median().reproject({crs: 'EPSG:32644', scale: 30});

//Check projection information                 
print('Projection, crs, and crs_transform:', S2_composite.projection());

//Load SRTM
var SRTM = ee.Image("USGS/SRTMGL1_003");
var elevation = SRTM.clip(boundary);

//Reproject to WGS 84 UTM zone 44N                
var elevation = elevation.reproject({crs: 'EPSG:32644',scale: 30}); 
  
//Check projection information
print('Projection, crs, and crs_transform:', elevation.projection()); 

//Derive slope from the SRTM
var slope = ee.Terrain.slope(SRTM).clip(boundary);

//Reproject to WGS 84 UTM zone 44N                
var slope = slope.reproject({crs: 'EPSG:32644',scale: 30}); 
  
//Check projection information
print('Projection, crs, and crs_transform:', slope.projection()); 

//Merge the predictor variables
var mergedCollection = S2_composite.addBands(elevation.addBands(slope));
var clippedmergedCollection = mergedCollection.clipToCollection(boundary);
print('clippedmergedCollection: ', clippedmergedCollection);

//Bands to include in the classification
var bands = ['B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B11', 'elevation', 'slope'];

//Prepare training dataset
var l4b = ee.Image('LARSE/GEDI/GEDI04_B_002');

var dataset = l4b.select('MU').clip(boundary);
Map.setCenter(79.81, 12.01, 12);

//Reproject to WGS 84 UTM zone 44N                  
var dataset = dataset.reproject({crs: 'EPSG:32644', scale: 100});

//Check projection information                 
print('Projection, crs, and crs_transform:', dataset.projection());

//Display the GEDI L4B dataset
Map.addLayer(dataset,
    {min: 10, max: 250, palette: '440154,414387,2a788e,23a884,7ad151,fde725'},
    'GEDI L4B Mean Biomass');

//Sample the training points from the GEDI L4B dataset
var points = dataset.sample({
   region: boundary,
   scale: 100,
   numPixels: 2000, 
   geometries: true});

//Print and display the points
print(points.size());
print(points.limit(10));
Map.addLayer(points);

//Split data into training and validation sets 
var datawithColumn = points.randomColumn('random', 27);
var split = 0.7; 
var trainingData = datawithColumn.filter(ee.Filter.lt('random', split));
print('training data', trainingData);

var validationData = datawithColumn.filter(ee.Filter.gte('random', split));
print('validation data', validationData);


//Perform random forest regression
var training = clippedmergedCollection.select(bands).sampleRegions({
  collection: trainingData,
  properties: ['MU'],
  scale: 100 // Need to change the scale of training data to avoid the 'out of memory' problem
  });

//Train a random forest classifier for regression 
var classifier = ee.Classifier.smileRandomForest(50)
  .setOutputMode('REGRESSION')
  .train({
    features: training, 
    classProperty: "MU",
    inputProperties: bands
    });

//Run the classification and clip it to the boundary
var regression = clippedmergedCollection.select(bands).classify(classifier, 'predicted').clip(boundary);

var palettes = require('users/gena/packages:palettes');
var palette = palettes.colorbrewer.YlGn[5];

//Display the input imagery and the regression classification
  var regressionMin = (regression.reduceRegion({
    reducer: ee.Reducer.min(),
    scale: 30, 
    crs: 'EPSG:32644',
    geometry: boundary,
    bestEffort: true,
    tileScale: 5
  }));
  
  var regressionMax = (regression.reduceRegion({
    reducer: ee.Reducer.max(),
    scale: 30, 
    crs: 'EPSG:32644',
    geometry: boundary,
    bestEffort: true,
    tileScale: 5
  }));

var viz = {palette: palette, min: regressionMin.getNumber('predicted').getInfo(), max: regressionMax.getNumber('predicted').getInfo()};
Map.addLayer(regression, viz, 'Regression');

var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px'
  }
});

var legendTitle = ui.Label({
  value: 'AGB Density (Mg/ha)',
  style: {
    fontWeight: 'bold',
    fontSize: '18px',
    margin: '0 0 4px 0',
    padding: '0'
  }
});

legend.add(legendTitle);

var lon = ee.Image.pixelLonLat().select('latitude');
var gradient = lon.multiply((viz.max-viz.min)/100.0).add(viz.min);
var legendImage = gradient.visualize(viz);


var panel = ui.Panel({
widgets: [
ui.Label(viz['max'])
],
});
 
legend.add(panel);
 
var thumbnail = ui.Thumbnail({
image: legendImage,
params: {bbox:'0,0,10,100', dimensions:'10x200'},
style: {padding: '1px', position: 'bottom-center'}
});
 
legend.add(thumbnail);
 
var panel = ui.Panel({
widgets: [
ui.Label(viz['min'])
],
});

legend.add(panel);
Map.add(legend);

Map.centerObject(boundary, 11);

//Check model performance
var classifier_details = classifier.explain();

//Explain the classifier with importance values
var variable_importance = ee.Feature(null, ee.Dictionary(classifier_details).get('importance'));

var chart =
  ui.Chart.feature.byProperty(variable_importance)
  .setChartType('ColumnChart')
  .setOptions({
  title: 'Random Forest Variable Importance',
  legend: {position: 'none'},
  hAxis: {title: 'Bands'},
  vAxis: {title: 'Importance'}
});

print("Variable importance:", chart);

//Create model assessment statistics
var predictedTraining = regression.sampleRegions({collection:trainingData, geometries: true});

//Separate the observed and predicted
var sampleTraining = predictedTraining.select(['MU', 'predicted']);

//Create chart, print it
var chartTraining = ui.Chart.feature.byFeature(sampleTraining, 'MU', 'predicted')
.setChartType('ScatterChart').setOptions({
title: 'Predicted vs Observed - Training data ',
hAxis: {'title': 'observed'},
vAxis: {'title': 'predicted'},
pointSize: 3,
trendlines: { 0: {showR2: true, visibleInLegend: true} ,
1: {showR2: true, visibleInLegend: true}}});
print(chartTraining);

//Compute RMSE
var observationTraining = ee.Array(sampleTraining.aggregate_array('MU'));
var predictionTraining = ee.Array(sampleTraining.aggregate_array('predicted'));

//Compute residuals
var residualsTraining = observationTraining.subtract(predictionTraining);

//Compute RMSE with equation and print the result
var rmseTraining = residualsTraining.pow(2).reduce('mean', [0]).sqrt();
print('Training RMSE', rmseTraining);

//Perform validation
var predictedValidation = regression.sampleRegions({collection:validationData, geometries: true});

//Separate the observed and predicted
var sampleValidation = predictedValidation.select(['MU', 'predicted']);

//Create chart and print it
var chartValidation = ui.Chart.feature.byFeature(sampleValidation, 'predicted', 'MU')
.setChartType('ScatterChart').setOptions({
title: 'Predicted vs Observed - Validation data',
hAxis: {'title': 'predicted'},
vAxis: {'title': 'observed'},
pointSize: 3,
trendlines: { 0: {showR2: true, visibleInLegend: true} ,
1: {showR2: true, visibleInLegend: true}}});
print(chartValidation);

//Compute RMSE
var observationValidation = ee.Array(sampleValidation.aggregate_array('MU'));
var predictionValidation = ee.Array(sampleValidation.aggregate_array('predicted'));

//Compute residuals
var residualsValidation = observationValidation.subtract(predictionValidation);

//Compute RMSE with equation and print it
var rmseValidation = residualsValidation.pow(2).reduce('mean', [0]).sqrt();
print('Validation RMSE', rmseValidation);

// @author: Originally by Ai.Geolabs
//          Adapted by failed-wizard
