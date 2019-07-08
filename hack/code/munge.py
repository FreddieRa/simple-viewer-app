import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from convertbng.util import convert_bng
from time import time
import os
os.chdir(r'./')
from utils_munge import *
import json

data_path = r'../data/extracted/IF19'

result_path = r'../data/result/IF19'

data_list = os.listdir(data_path)

# read data
nodes = pd.read_csv(data_path + '/' + 'sewer_nodes.csv')
frame = pd.read_csv(data_path + '/' + 'sewer.csv')

frame = frame.drop('InfCovLev', axis=1) # All null

# Convert back to metre
frame[['Height', 'Width', 'UpDepth', 'DownDepth', 'ReviewDiam']] /= 1000
nodes[['InvertDept', 'CoverLevel', 'InfCovLev']] /= 1000

# clean coordinates
nodes = clean_coordinates(nodes, mode='node')

# Impute cover level
nodes['CoverLevel'].fillna(nodes['InfCovLev'], inplace=True)
nodes = nodes[['X', 'Y', 'NodeRefere', 'InvertDept', 'CoverLevel']]

#coordinate start is always from upnode
# merge nodes
frame = merge_nodes(frame, nodes)
        
# Impute missing
# Depth
frame = impute_depth(frame)

# Height
frame = impute_height(frame)

# Compute elevation
frame = compute_elevation_pipe(frame)

# interpolate points
points = interpolate(frame)

# Compute points' elevations
points = compute_elevation_point(points)

# query the 10 nearest points in the 10m radius (square actually)
radius = 10
n_points = 10
X = points['X'][300]
Y = points['Y'][300]

selected = get_nearest_in_area(X, Y, points, radius, n_points, False, True)

print(selected)

# Dump
#points.to_csv(result_path + '/result.csv', index=False)
#
#with open(result_path + '/query.json', 'w') as f:
#    json.dump(json.loads(selected), f)